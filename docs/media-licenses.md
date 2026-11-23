# Destination media provenance

All eight destination reels and their poster frames were created for CloudSentinel. The tracked generator draws them from code using Canvas 2D and records the canvas with MediaRecorder. No stock footage, reference-site footage, audio, fonts, or third-party artwork are embedded in the files. No third-party asset license or attribution applies.

| Destination | Original artwork | Clip and poster stems |
| --- | --- | --- |
| Overview | Perspective server racks, status lights, and volumetric aisle haze | `overview` |
| Environments | Cloud layers, abstract infrastructure silhouettes, and orbital survey traces | `environments` |
| Findings | Broken optical scan lines and displaced fragments | `findings` |
| Assets | Oblique processor macro with moving circuit signals | `assets` |
| Identity | Concentric access structures and a faceted central key | `identity` |
| Threats | Carrier interference bands with a moving signal envelope | `threats` |
| AI Analyst | Particle streams moving along a field of filaments | `analyst` |
| Audit | Chronological traces with a travelling light sweep | `audit` |

Each stem has a silent 768 × 432 VP8 WebM and a WebP poster in `client/src/media/destinations`. Source and original artwork credit are [CloudSentinel’s procedural film generator](../client/generate-stage-media.html). The grain tile is [original CloudSentinel SVG artwork](../client/src/media/film-grain.svg).

The build emits WebMs of roughly 280–300 kB and posters of roughly 12–40 kB. The visible selected reel owns one decoder. The destination attaches that same player and keeps its playhead through entry and return. Scrolling past the film pauses it. Selecting a different reel unloads the previous source. The poster provides the fallback for reduced motion and reduced data.

These visuals are atmospheric. The application’s security evidence, findings, and scan status come from the existing authenticated APIs.
