// A2UI v0.9 messages the fixture is driven with. They are plain literals typed as protocol input,
// not built by SAGA's decoder: GenUI 0.7.0 interprets them with its own processor.

const CATALOG_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json';

export const createSurface = (surfaceId: string) => ({
  version: 'v0.9',
  createSurface: { surfaceId, catalogId: CATALOG_ID },
});

export const updateComponents = (
  surfaceId: string,
  components: readonly unknown[],
) => ({
  version: 'v0.9',
  updateComponents: { surfaceId, components },
});

export const updateData = (
  surfaceId: string,
  path: string,
  value: unknown,
) => ({
  version: 'v0.9',
  updateDataModel: { surfaceId, path, value },
});

export const text = (id: string, label: string) => ({
  id,
  component: 'Text',
  text: label,
});

/** A fixed control that shows the order id at `/order/id`. */
export const orderControl = (
  id: string,
  label: string,
  extra: Record<string, unknown> = {},
) => [
  {
    id,
    component: 'ActionButton',
    child: `${id}-label`,
    orderId: { path: '/order/id' },
    ...extra,
  },
  text(`${id}-label`, label),
];

/**
 * Two definitions on one control kind (submit, cancel), a control no setup binds (refund), one
 * whose setup binds and then throws (flaky), and an upstream Button with its own protocol action.
 */
export const ORDERS = 'orders';
export const ordersLayout = [
  createSurface(ORDERS),
  updateComponents(ORDERS, [
    {
      id: 'root',
      component: 'Column',
      children: [
        'submit-order',
        'cancel-order',
        'refund-order',
        'flaky',
        'help',
      ],
    },
    ...orderControl('submit-order', 'Submit'),
    ...orderControl('cancel-order', 'Cancel order'),
    ...orderControl('refund-order', 'Refund'),
    ...orderControl('flaky', 'Flaky'),
    {
      id: 'help',
      component: 'Button',
      child: 'help-label',
      action: { event: { name: 'open_help' } },
    },
    text('help-label', 'Help'),
  ]),
  updateData(ORDERS, '/', { order: { id: 'order-1' } }),
];

/** The same template inside the upstream scrolling `List`, which renders a native `<list>`. */
export const LONG = 'long';
export const longListLayout = (count: number) => [
  createSurface(LONG),
  updateComponents(LONG, [
    {
      id: 'root',
      component: 'List',
      children: { componentId: 'row-archive', path: '/notes' },
    },
    {
      id: 'row-archive',
      component: 'ActionButton',
      child: 'row-label',
      noteId: { path: 'id' },
    },
    { id: 'row-label', component: 'Text', text: { path: 'title' } },
  ]),
  updateData(LONG, '/', {
    notes: Array.from({ length: count }, (_, index) => ({
      id: `note-${index}`,
      title: `Note ${index} with a label long enough to take a line`,
    })),
  }),
];

/** A template: one `row-archive` control per note, each reading its own relative `id`. */
export const NOTES = 'notes';
export const notesLayout = (
  notes: ReadonlyArray<{ id: string; title: string }>,
) => [
  createSurface(NOTES),
  updateComponents(NOTES, [
    {
      id: 'root',
      component: 'Column',
      children: { componentId: 'row-archive', path: '/notes' },
    },
    {
      id: 'row-archive',
      component: 'ActionButton',
      child: 'row-label',
      noteId: { path: 'id' },
    },
    { id: 'row-label', component: 'Text', text: { path: 'title' } },
  ]),
  updateData(NOTES, '/', { notes }),
];

/**
 * ACT4: a fixed control that waits for a session (`review-order`, showing the order at `/order/id`)
 * and a template whose rows each carry a pending piece of work (`row-stage`, one per note).
 */
export const ASYNC = 'async';
export const asyncLayout = (
  notes: ReadonlyArray<{ id: string; title: string }>,
) => [
  createSurface(ASYNC),
  updateComponents(ASYNC, [
    {
      id: 'root',
      component: 'Column',
      children: ['review-order', 'stage-list'],
    },
    ...orderControl('review-order', 'Review'),
    {
      id: 'stage-list',
      component: 'Column',
      children: { componentId: 'row-stage', path: '/notes' },
    },
    {
      id: 'row-stage',
      component: 'ActionButton',
      child: 'row-stage-label',
      noteId: { path: 'id' },
    },
    { id: 'row-stage-label', component: 'Text', text: { path: 'title' } },
  ]),
  updateData(ASYNC, '/', { order: { id: 'order-1' }, notes }),
];
