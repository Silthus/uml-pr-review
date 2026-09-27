import type { Detector } from "../context.ts";
import { importFindings, layeringImportRules } from "./imports.ts";
import { textFindings, type TextRule } from "./text.ts";

const testOrStory = /(^|\/)(tests?|__tests__)\/|\.(test|spec|stories)\.[jt]sx?$|(^|\/)test_[^/]*\.py$/;

export const layeringTextRules: TextRule[] = [
  {
    detector: "layering",
    rule: "component-state",
    files: /^(frontend\/src|products\/[^/]+\/frontend)\/.*\.tsx$/,
    exclude: testOrStory,
    pattern: /\b(useState|useEffect|useMemo|useCallback|useReducer)\s*[<(]/g,
    message: "a component holds state or derivation that belongs in its kea logic",
  },
  { detector: "layering", rule: "facade-imports-drf", files: /^products\/[^/]+\/backend\/facade\/.*\.py$/, pattern: /^\s*(?:from|import)\s+(rest_framework)\b/g, message: "a facade must not import DRF" },
  { detector: "layering", rule: "contracts-import-django", files: /^products\/[^/]+\/backend\/facade\/contracts\.py$/, pattern: /^\s*(?:from|import)\s+(django|rest_framework)\b/g, message: "contracts must not depend on Django or DRF" },
  { detector: "layering", rule: "get-model", files: /\.py$/, exclude: /(^|\/)migrations\/|(^|\/)tests?\/|(^|\/)test_[^/]*\.py$/, pattern: /\bapps\.get_model\(\s*["']([^"']+)["']/g, message: "a model reached through the app registry, invisible to import boundaries" },
];

export const layering: Detector = async (context) => {
  const [byImports, byText] = await Promise.all([importFindings(context, layeringImportRules), Promise.resolve(textFindings(context, layeringTextRules))]);
  return { introduced: [...byImports.introduced, ...byText.introduced], removed: [...byImports.removed, ...byText.removed] };
};
