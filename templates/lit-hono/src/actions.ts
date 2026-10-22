import { Action, type ActionButtonActivation } from '@saga-a2ui/lit-mcp-stack';

// The application's actions, each defined once. A definition is immutable and holds no pending
// state, so one definition can be attached to any number of rendered controls; each attachment
// keeps its own state. The application attaches them (view.ts); no markup names them.

export interface StarterEnvironment {
  /** The application-owned input the Clear control empties. */
  readonly noteInput: HTMLInputElement;
}

export function createStarterActions(environment: StarterEnvironment) {
  /** A local action: no server request and no prerequisite. */
  const clearNote = Action.local<ActionButtonActivation>('clear-note')
    .run(() => {
      environment.noteInput.value = '';
      environment.noteInput.focus();
    })
    .build();

  return { clearNote };
}
