export { MAX_ARMS, reconcile, type ExistingWallet, type Reconciliation } from './reconcile.js'
export {
  WALLET_TYPES,
  WalletError,
  addAgenticWallet,
  addWatchOnlyWallet,
  listWallets,
  syncWallets,
  unlinkWallet,
  updateWallet,
  type AgenticInput,
  type AgenticProof,
  type Arm,
  type SyncResult,
  type WalletDb,
  type WalletEdit,
  type WatchOnlyInput,
} from './store.js'
export {
  AGENTIC,
  AGENT_PROVIDERS,
  agentProvider,
  capabilitiesOf,
  profileOf,
  type AgentProviderProfile,
  type ArmCapabilities,
} from './agentic/index.js'
export {
  CHALLENGE_TTL_MS,
  LinkError,
  finishAgentLink,
  linkTypedData,
  startAgentLink,
  type AgentLinkChallenge,
  type FinishLinkInput,
  type StartLinkInput,
} from './agentic/link.js'
