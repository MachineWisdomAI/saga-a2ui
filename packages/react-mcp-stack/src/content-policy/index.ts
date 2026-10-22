// The content-policy entry of the stack: how a server states and embeds the content policy that
// the card application reads back from its document at startup. The policy is the owner's
// (`@saga-a2ui/components`); this entry only names it for an application that installs the stack.
// It carries no renderer and no delivery, and the own-catalog entry does not import it.
export {
  createContentPolicy,
  embedContentPolicy,
  type ContentPolicy,
  type CreatePolicyResult,
  type PolicyConfiguration,
  type PolicyFailure,
} from '@saga-a2ui/components/faithful-card';
