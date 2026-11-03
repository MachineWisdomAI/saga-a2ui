// The contract of the application's own `Line` component, shared by every renderer's catalog.
// `Line` shows supplied text as text, never as markup, in one of three roles. The roles are the
// one place that says what a layout may give it; each renderer's catalog states the schema over
// them with the `z` and `CommonSchemas` of the stack it installs, and supplies only the element.

export const LINE_KINDS = ['title', 'body', 'status'] as const;
