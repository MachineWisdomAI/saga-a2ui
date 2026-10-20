import { startNotesReactView } from './notes-react-view.js';

// The React consumer: the application's own React catalog alone. It imports no SAGA optional
// component and no Lit code, so its build holds neither the FaithfulCard nor a Lit element.
await startNotesReactView();
