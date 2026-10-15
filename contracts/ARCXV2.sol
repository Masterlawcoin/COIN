// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function allowance(address,address) external view returns (uint256);
    function approve(address,uint256) external returns (bool);
    function transfer(address,uint256) external returns (bool);
    function transferFrom(address,address,uint256) external returns (bool);
}

library SafeToken {
    function _call(address token, bytes memory data) private returns (bytes memory r) {
        (bool ok, bytes memory out) = token.call(data);
        require(ok && (out.length == 0 || abi.decode(out,(bool))), "TOKEN_CALL");
        return out;
    }
    function transfer(address token,address to,uint256 a) internal { _call(token,abi.encodeWithSelector(IERC20.transfer.selector,to,a)); }
    function transferFrom(address token,address f,address t,uint256 a) internal { _call(token,abi.encodeWithSelector(IERC20.transferFrom.selector,f,t,a)); }
    function approve(address token,address s,uint256 a) internal { _call(token,abi.encodeWithSelector(IERC20.approve.selector,s,a)); }
}

abstract contract ReentrancyGuard {
    uint256 private _lock = 1;
    modifier nonReentrant(){ require(_lock==1,"REENTRANT"); _lock=2; _; _lock=1; }
}

contract ARCXToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    event Transfer(address indexed from,address indexed to,uint256 value);
    event Approval(address indexed owner,address indexed spender,uint256 value);
    constructor(string memory n,string memory s,uint256 supply,address receiver){
        require(bytes(n).length>0 && bytes(s).length>0,"META");
        require(receiver!=address(0) && supply>0,"PARAM");
        name=n; symbol=s; totalSupply=supply; balanceOf[receiver]=supply;
        emit Transfer(address(0),receiver,supply);
    }
    function transfer(address to,uint256 a) external returns(bool){ _move(msg.sender,to,a); return true; }
    function approve(address sp,uint256 a) external returns(bool){ allowance[msg.sender][sp]=a; emit Approval(msg.sender,sp,a); return true; }
    function transferFrom(address f,address t,uint256 a) external returns(bool){
        uint256 x=allowance[f][msg.sender]; require(x>=a,"ALLOW");
        if(x!=type(uint256).max){ allowance[f][msg.sender]=x-a; emit Approval(f,msg.sender,x-a); }
        _move(f,t,a); return true;
    }
    function _move(address f,address t,uint256 a) internal { require(t!=address(0),"ZERO"); uint256 b=balanceOf[f]; require(b>=a,"BAL"); unchecked{balanceOf[f]=b-a;} balanceOf[t]+=a; emit Transfer(f,t,a); }
}

contract ARCXTokenFactory {
    event TokenCreated(address indexed creator,address indexed token,string name,string symbol,uint256 supply,address receiver);
    address[] public allTokens;
    mapping(address=>bool) public createdHere;
    function createToken(string calldata n,string calldata s,uint256 wholeSupply,address receiver) external returns(address token){
        require(wholeSupply>0 && wholeSupply<=1e18,"SUPPLY_RANGE");
        if(receiver==address(0)) receiver=msg.sender;
        uint256 supply=wholeSupply*1e18;
        token=address(new ARCXToken(n,s,supply,receiver));
        createdHere[token]=true; allTokens.push(token);
        emit TokenCreated(msg.sender,token,n,s,supply,receiver);
    }
    function tokenCount() external view returns(uint256){ return allTokens.length; }
}

contract ARCXPair is ReentrancyGuard {
    using SafeToken for address;
    address public immutable usdc;
    address public immutable token;
    address public immutable factory;
    uint256 public reserveUSDC;
    uint256 public reserveToken;
    uint256 public totalLiquidity;
    mapping(address=>uint256) public liquidityOf;
    event LiquidityAdded(address indexed provider,uint256 usdc,uint256 token,uint256 shares);
    event LiquidityRemoved(address indexed provider,uint256 usdc,uint256 token,uint256 shares);
    event Swap(address indexed trader,bool usdcToToken,uint256 amountIn,uint256 amountOut,address indexed to,uint256 reserveUSDC,uint256 reserveToken);
    constructor(address u,address t){ require(u!=address(0)&&t!=address(0)&&u!=t,"PAIR"); usdc=u; token=t; factory=msg.sender; }
    function quoteUSDCForToken(uint256 a) public view returns(uint256){ if(a==0||reserveUSDC==0||reserveToken==0)return 0; uint256 f=a*997; return reserveToken*f/(reserveUSDC*1000+f); }
    function quoteTokenForUSDC(uint256 a) public view returns(uint256){ if(a==0||reserveUSDC==0||reserveToken==0)return 0; uint256 f=a*997; return reserveUSDC*f/(reserveToken*1000+f); }
    function spotPriceE6() external view returns(uint256){ if(reserveToken==0)return 0; return reserveUSDC*1e18*1e6/reserveToken/1e6; }
    function addLiquidity(uint256 maxUSDC,uint256 maxToken,uint256 minShares,address to) external nonReentrant returns(uint256 usedUSDC,uint256 usedToken,uint256 shares){
        require(to!=address(0)&&maxUSDC>0&&maxToken>0,"PARAM");
        uint256 ru=reserveUSDC; uint256 rt=reserveToken;
        if(ru==0||rt==0){ usedUSDC=maxUSDC; usedToken=maxToken; shares=_sqrt(usedUSDC*usedToken); require(shares>1000,"INIT_SMALL"); }
        else {
            uint256 optimalToken=maxUSDC*rt/ru;
            if(optimalToken<=maxToken){ usedUSDC=maxUSDC; usedToken=optimalToken; }
            else { usedToken=maxToken; usedUSDC=maxToken*ru/rt; }
            uint256 s1=usedUSDC*totalLiquidity/ru; uint256 s2=usedToken*totalLiquidity/rt; shares=s1<s2?s1:s2;
        }
        require(shares>=minShares && shares>0,"SHARES");
        uint256 bu=IERC20(usdc).balanceOf(address(this)); uint256 bt=IERC20(token).balanceOf(address(this));
        usdc.transferFrom(msg.sender,address(this),usedUSDC); token.transferFrom(msg.sender,address(this),usedToken);
        require(IERC20(usdc).balanceOf(address(this))==bu+usedUSDC && IERC20(token).balanceOf(address(this))==bt+usedToken,"FEE_TOKEN_IN");
        reserveUSDC=ru+usedUSDC; reserveToken=rt+usedToken; totalLiquidity+=shares; liquidityOf[to]+=shares;
        emit LiquidityAdded(to,usedUSDC,usedToken,shares);
    }
    function removeLiquidity(uint256 shares,uint256 minUSDC,uint256 minToken,address to) external nonReentrant returns(uint256 outUSDC,uint256 outToken){
        require(to!=address(0)&&shares>0&&liquidityOf[msg.sender]>=shares,"PARAM");
        uint256 tl=totalLiquidity; require(tl>0,"NO_LIQ");
        outUSDC=reserveUSDC*shares/tl; outToken=reserveToken*shares/tl;
        require(outUSDC>=minUSDC&&outToken>=minToken&&outUSDC>0&&outToken>0,"MIN");
        liquidityOf[msg.sender]-=shares; totalLiquidity=tl-shares; reserveUSDC-=outUSDC; reserveToken-=outToken;
        usdc.transfer(to,outUSDC); token.transfer(to,outToken);
        emit LiquidityRemoved(msg.sender,outUSDC,outToken,shares);
    }
    function swapUSDCForToken(uint256 amountIn,uint256 minOut,address to) external nonReentrant returns(uint256 out){
        require(to!=address(0)&&amountIn>0,"PARAM"); out=quoteUSDCForToken(amountIn); require(out>=minOut&&out>0&&out<reserveToken,"MIN");
        uint256 b=IERC20(usdc).balanceOf(address(this)); usdc.transferFrom(msg.sender,address(this),amountIn); require(IERC20(usdc).balanceOf(address(this))==b+amountIn,"FEE_TOKEN_IN");
        reserveUSDC+=amountIn; reserveToken-=out; token.transfer(to,out); emit Swap(msg.sender,true,amountIn,out,to,reserveUSDC,reserveToken);
    }
    function swapTokenForUSDC(uint256 amountIn,uint256 minOut,address to) external nonReentrant returns(uint256 out){
        require(to!=address(0)&&amountIn>0,"PARAM"); out=quoteTokenForUSDC(amountIn); require(out>=minOut&&out>0&&out<reserveUSDC,"MIN");
        uint256 b=IERC20(token).balanceOf(address(this)); token.transferFrom(msg.sender,address(this),amountIn); require(IERC20(token).balanceOf(address(this))==b+amountIn,"FEE_TOKEN_IN");
        reserveToken+=amountIn; reserveUSDC-=out; usdc.transfer(to,out); emit Swap(msg.sender,false,amountIn,out,to,reserveUSDC,reserveToken);
    }
    function _sqrt(uint256 y) internal pure returns(uint256 z){ if(y>3){z=y;uint256 x=y/2+1;while(x<z){z=x;x=(y/x+x)/2;}}else if(y!=0){z=1;} }
}

contract ARCXMarketFactory {
    address public owner;
    address public immutable usdc;
    struct Market { address pair; address creator; bool verified; bool active; string metadataURI; }
    mapping(address=>Market) public markets;
    address[] public allTokens;
    event OwnershipTransferred(address indexed oldOwner,address indexed newOwner);
    event MarketCreated(address indexed token,address indexed pair,address indexed creator,string metadataURI);
    event MetadataUpdated(address indexed token,string metadataURI);
    event MarketStatus(address indexed token,bool verified,bool active);
    constructor(address u){ require(u!=address(0),"USDC"); owner=msg.sender; usdc=u; emit OwnershipTransferred(address(0),msg.sender); }
    modifier onlyOwner(){require(msg.sender==owner,"OWNER");_;}
    function transferOwnership(address n) external onlyOwner { require(n!=address(0),"ZERO"); emit OwnershipTransferred(owner,n); owner=n; }
    function createMarket(address token,string calldata uri) external returns(address pair){
        require(token!=address(0)&&token!=usdc&&token.code.length>0&&markets[token].pair==address(0),"MARKET");
        (bool ok,bytes memory d)=token.staticcall(abi.encodeWithSignature("decimals()"));
        require(ok&&d.length>=32&&abi.decode(d,(uint8))==18,"DECIMALS");
        pair=address(new ARCXPair(usdc,token));
        markets[token]=Market(pair,msg.sender,false,true,uri); allTokens.push(token);
        emit MarketCreated(token,pair,msg.sender,uri);
    }
    function updateMetadata(address token,string calldata uri) external { Market storage m=markets[token]; require(m.pair!=address(0)&&msg.sender==m.creator,"CREATOR"); m.metadataURI=uri; emit MetadataUpdated(token,uri); }
    function setMarketStatus(address token,bool verified,bool active) external onlyOwner { Market storage m=markets[token]; require(m.pair!=address(0),"NO_MARKET"); m.verified=verified; m.active=active; emit MarketStatus(token,verified,active); }
    function marketCount() external view returns(uint256){return allTokens.length;}
}

contract ARCXRouter is ReentrancyGuard {
    using SafeToken for address;
    ARCXMarketFactory public immutable factory;
    address public immutable usdc;
    constructor(address f){ factory=ARCXMarketFactory(f); usdc=factory.usdc(); }
    function _pair(address token) internal view returns(address p){ (address pair,,,bool active,)=factory.markets(token); require(pair!=address(0)&&active,"MARKET_INACTIVE"); return pair; }
    function buy(address token,uint256 amountIn,uint256 minOut) external nonReentrant returns(uint256 out){
        address p=_pair(token); usdc.transferFrom(msg.sender,address(this),amountIn); usdc.approve(p,0); usdc.approve(p,amountIn); out=ARCXPair(p).swapUSDCForToken(amountIn,minOut,msg.sender); usdc.approve(p,0);
    }
    function sell(address token,uint256 amountIn,uint256 minOut) external nonReentrant returns(uint256 out){
        address p=_pair(token); token.transferFrom(msg.sender,address(this),amountIn); token.approve(p,0); token.approve(p,amountIn); out=ARCXPair(p).swapTokenForUSDC(amountIn,minOut,msg.sender); token.approve(p,0);
    }
}
