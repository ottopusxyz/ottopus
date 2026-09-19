import { type Abi, type AbiFunction, parseAbi, toFunctionSelector } from 'viem'

/**
 * The ABIs we know without asking anyone. Decoding tries these first: a
 * transfer or an approval must read the same on every chain and every token,
 * and a lookup service being down must not turn "send 500 USDC" into raw
 * calldata.
 *
 * ERC-721's approve(address,uint256) shares a selector with ERC-20's. Both
 * decode as an approval of something to someone, which is the reading that
 * matters for review.
 */
export const KNOWN_ABI = parseAbi([
  // ERC-20
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function increaseAllowance(address spender, uint256 addedValue) returns (bool)',
  'function decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)',
  // WETH
  'function deposit() payable',
  'function withdraw(uint256 wad)',
  // ERC-721 / ERC-1155
  'function setApprovalForAll(address operator, bool approved)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
])

/** Selector → item, for the first pass. */
export const KNOWN_BY_SELECTOR: ReadonlyMap<string, AbiFunction> = new Map(
  (KNOWN_ABI as Abi).filter((item): item is AbiFunction => item.type === 'function').map((item) => [
    toFunctionSelector(item),
    item,
  ]),
)
