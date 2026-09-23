import { objectFields } from "./types";

/** WebFetch: { result, url, code, ... }; the model-processed page text is in `result`. */
export const webFetchAdapter = objectFields(["result"]);
