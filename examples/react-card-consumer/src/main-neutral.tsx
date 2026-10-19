import neutralArtwork from '../assets/neutral-mark.svg?inline';
import './brands/neutral.css';
import { mountCardView } from './card-view.js';

// Composition root of the neutral resource: the shared implementation with the neutral brand.
await mountCardView({ name: 'Neutral Notes', artwork: neutralArtwork });
