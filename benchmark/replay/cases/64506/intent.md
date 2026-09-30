# chore(nodejs): separate ingestion code from CDP

The Node.js service mixes ingestion and CDP code, which makes it hard for the two systems to evolve and be tested independently. This change moves ingestion code into its own tree under `src/ingestion/`, with code shared between ingestion and CDP in `src/common/`.

As part of it, add the event pipeline's transform step in `nodejs/src/ingestion/common/event-pipeline/transformEventStep.ts`: an exported async `transformEventStep(event, hogTransformer)` that runs a plugin event through the hog transformations and returns the transformation result. When there is no hog transformer, it returns the event unchanged with no invocation results.

Follow the codebase's conventions. Do not run git.
