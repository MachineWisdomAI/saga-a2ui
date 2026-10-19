import harborArtwork from '../assets/harbor-mark.svg?inline';
import './brands/harbor.css';
import { mountCardView } from './card-view.js';

// Composition root of the differently branded resource: the same implementation, its own tokens, artwork and font.
await mountCardView({ name: 'Harbor Notes', artwork: harborArtwork });
