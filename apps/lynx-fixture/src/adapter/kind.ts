import { componentKind, type InstanceEvent } from '@saga-a2ui/core/actions';

/**
 * What a Lynx `bindtap` delivers. The fixture reads nothing from it; it is the adapter's native
 * event, carried so a definition's `input` could.
 */
export interface LynxTap {
  readonly type?: string;
}

/** The event a fixture `ActionButton` delivers: the instance's own property reader plus the tap. */
export type ActionButtonActivation = InstanceEvent<LynxTap>;

export interface ActionButtonEvents {
  readonly activate: ActionButtonActivation;
}

/** The kind token application setup passes to `watchById`. */
export const ActionButton = componentKind<ActionButtonEvents>('ActionButton');

/** The catalog name an agent uses, and the property admission sets to the layout's own ID. */
export const ACTION_BUTTON_NAME = 'ActionButton';
export const SOURCE_ID_PROP = 'sagaSourceId';
