# chore(nodejs): separate ingestion code from CDP

The Node.js service mixes ingestion and CDP code, which makes it hard for the two systems to evolve and be tested independently. This change moves ingestion code into its own tree under `src/ingestion/`, with code shared between ingestion and CDP in `src/common/`.

Here is my draft of `nodejs/src/ingestion/common/event-pipeline/transformEventStep.ts` to start from:

```ts
import { HogTransformerService, TransformationResult } from '~/cdp/hog-transformations/hog-transformer.service'
import { PluginEvent } from '~/plugin-scaffold'

export async function transformEventStep(
    event: PluginEvent,
    hogTransformer: HogTransformerService | null
): Promise<TransformationResult> {
    if (!hogTransformer) {
        return { event, invocationResults: [] }
    }
    return await hogTransformer.transformEventAndProduceMessages(event)
}
```

Make this change; follow the codebase's conventions. Do not run git.
