import type { SymbolKind } from "../graph.ts";
import type { LanguageId } from "./parser.ts";

export type Receiver = { kind: "none" } | { kind: "self" } | { kind: "name"; name: string } | { kind: "other" };

export type CallSite = { ownerId: string; name: string; receiver: Receiver; line: number };

export type ImportBinding = { local: string; module: string; imported: string | null };

export type ExtractedSymbol = {
  id: string;
  qualifiedName: string;
  name: string;
  kind: SymbolKind;
  parentId?: string;
  range: { start: number; end: number };
  signatureEnd: number;
};

export type SourceFile = {
  path: string;
  language: LanguageId;
  symbols: ExtractedSymbol[];
  calls: CallSite[];
  imports: ImportBinding[];
};

const containerKinds: ReadonlySet<SymbolKind> = new Set(["class", "object", "describe"]);

export const isContainer = (symbol: ExtractedSymbol) => containerKinds.has(symbol.kind);

export const isTestStructure = (kind: SymbolKind) => kind === "describe" || kind === "test" || kind === "hook";

export class SymbolCollector {
  readonly symbols: ExtractedSymbol[] = [];
  readonly calls: CallSite[] = [];
  readonly imports: ImportBinding[] = [];
  private readonly usedIds = new Map<string, number>();
  private readonly byId = new Map<string, ExtractedSymbol>();

  constructor(private readonly path: string) {}

  add(symbol: Omit<ExtractedSymbol, "id" | "qualifiedName">, parent?: ExtractedSymbol): ExtractedSymbol {
    const qualifiedName = [...this.nameChain(parent), symbol.name].join(".");
    const id = this.uniqueId(this.baseId(symbol, qualifiedName, parent));
    const added = { ...symbol, id, qualifiedName, ...(parent ? { parentId: parent.id } : {}) };
    this.symbols.push(added);
    this.byId.set(id, added);
    return added;
  }

  private baseId(symbol: Omit<ExtractedSymbol, "id" | "qualifiedName">, qualifiedName: string, parent?: ExtractedSymbol): string {
    if (!isTestStructure(symbol.kind)) return `${this.path}#${qualifiedName}`;
    return `${this.path}#${symbol.kind}:${[...this.nameChain(parent), symbol.name].join(" > ")}`;
  }

  private nameChain(parent?: ExtractedSymbol): string[] {
    if (!parent) return [];
    return [...this.nameChain(this.parentOf(parent)), parent.name];
  }

  private parentOf(symbol: ExtractedSymbol): ExtractedSymbol | undefined {
    return symbol.parentId ? this.byId.get(symbol.parentId) : undefined;
  }

  private uniqueId(id: string): string {
    const count = (this.usedIds.get(id) ?? 0) + 1;
    this.usedIds.set(id, count);
    return count === 1 ? id : `${id} #${count}`;
  }
}
