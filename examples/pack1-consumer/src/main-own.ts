import { startNotesView } from './notes-view.js';

// The own-catalog consumer: the application's catalog alone. It imports no SAGA optional component,
// so its build holds neither the FaithfulCard element nor the Markdown parser.
await startNotesView();
