//#endregion
//#region src/lib/elements.ts
/** the element registry — data lives in the shared plain-JS module so the
* node exporter (server/export.mjs) consumes the exact same source */
var ELEMENTS = {
	/** page root wrap — selectable but never added, removed, or reordered */
	body: {
		tag: "div",
		suggest: "section"
	},
	section: {
		tag: "section",
		suggest: "div"
	},
	div: {
		tag: "div",
		suggest: "h2"
	},
	container: {
		tag: "div",
		suggest: "div"
	},
	grid: {
		tag: "div",
		suggest: "div"
	},
	header: {
		tag: "header",
		suggest: "nav"
	},
	footer: {
		tag: "footer",
		suggest: "text"
	},
	article: {
		tag: "article",
		suggest: "h2"
	},
	nav: {
		tag: "nav",
		suggest: "link"
	},
	main: {
		tag: "main",
		suggest: "section"
	},
	aside: {
		tag: "aside",
		suggest: "h3"
	},
	text: {
		tag: "div",
		defaultContent: "Lorem ipsum"
	},
	h1: {
		tag: "h1",
		defaultContent: "Lorem ipsum"
	},
	h2: {
		tag: "h2",
		defaultContent: "Lorem ipsum"
	},
	h3: {
		tag: "h3",
		defaultContent: "Lorem ipsum"
	},
	h4: {
		tag: "h4",
		defaultContent: "Lorem ipsum"
	},
	h5: {
		tag: "h5",
		defaultContent: "Lorem ipsum"
	},
	h6: {
		tag: "h6",
		defaultContent: "Lorem ipsum"
	},
	heading: {
		tag: "h2",
		defaultContent: "Lorem ipsum"
	},
	label: {
		tag: "label",
		suggest: "span",
		seed: {
			type: "span",
			content: "Label"
		}
	},
	paragraph: {
		tag: "p",
		defaultContent: "Dolor sit amet"
	},
	span: {
		tag: "span",
		defaultContent: "Dolor sit amet"
	},
	list: {
		tag: "ul",
		suggest: "list-item"
	},
	"list-item": {
		tag: "li",
		suggest: "text"
	},
	image: {
		tag: "img",
		void: true
	},
	video: { tag: "video" },
	form: {
		tag: "form",
		suggest: "input"
	},
	input: {
		tag: "input",
		void: true
	},
	textarea: { tag: "textarea" },
	checkbox: {
		tag: "input",
		void: true,
		attrs: { type: "checkbox" }
	},
	radio: {
		tag: "input",
		void: true,
		attrs: { type: "radio" }
	},
	fieldset: {
		tag: "fieldset",
		suggest: "legend"
	},
	legend: {
		tag: "legend",
		defaultContent: "Legend"
	},
	dropdown: {
		tag: "select",
		suggest: "option"
	},
	select: {
		tag: "select",
		suggest: "option"
	},
	option: {
		tag: "option",
		defaultContent: "Option"
	},
	button: {
		tag: "button",
		suggest: "span",
		seed: {
			type: "span",
			content: "Button"
		}
	},
	link: {
		tag: "a",
		suggest: "span",
		seed: {
			type: "span",
			content: "Link"
		}
	},
	table: {
		tag: "table",
		suggest: "thead"
	},
	thead: {
		tag: "thead",
		suggest: "tr"
	},
	tbody: {
		tag: "tbody",
		suggest: "tr"
	},
	tr: {
		tag: "tr",
		suggest: "td"
	},
	th: {
		tag: "th",
		suggest: "text"
	},
	td: {
		tag: "td",
		suggest: "text"
	},
	/** repeats its children once per entry of the collection in its arg */
	"collection-list": {
		tag: "div",
		suggest: "div"
	},
	/** renders one picked entry through its collection's template */
	"collection-item": {
		tag: "div",
		defaultContent: ""
	},
	/** carousel. With an arg it repeats its children per entry like a
	* :collection-list (one slide each); without one, each direct child is a
	* slide. Arrows/dots are built-in chrome — see shared/slider.js */
	slider: {
		tag: "div",
		suggest: "div"
	}
};
function isKnownElement(type) {
	return type in ELEMENTS;
}
/**
* A leaf element carries text content or is void — it is ALWAYS written as
* `:name:` and can never be opened as a block. Everything else (section,
* div, form, list, …) is a container: `:name … name:`.
*/
function isLeafElement(type) {
	const def = ELEMENTS[type];
	return !!def && (def.defaultContent !== void 0 || def.void === true);
}
function createNode(type) {
	return {
		id: crypto.randomUUID(),
		type,
		content: "",
		children: []
	};
}
/** types an element can switch between (same structural shape per group) */
var TYPE_GROUPS = [
	[
		"section",
		"div",
		"container",
		"grid",
		"header",
		"footer",
		"article",
		"nav",
		"main",
		"aside",
		"list-item"
	],
	[
		"heading",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6"
	],
	[
		"text",
		"paragraph",
		"span"
	],
	[
		"button",
		"link",
		"label"
	],
	["list", "form"],
	["thead", "tbody"],
	["th", "td"]
];
function typeOptionsFor(type) {
	return TYPE_GROUPS.find((group) => group.includes(type)) ?? [];
}
//#endregion
//#region src/lib/tree.ts
/** structural deep clone via JSON round-trip — for plain serializable data
* (pages, nodes, entries, the project itself) */
function deepClone(value) {
	return JSON.parse(JSON.stringify(value));
}
/** depth-first visit of every node in the element tree */
function walkNodes(nodes, visit) {
	for (const node of nodes) {
		visit(node);
		walkNodes(node.children, visit);
	}
}
/** finds a node anywhere in the tree by id */
function findNode(nodes, id) {
	for (const node of nodes) {
		if (node.id === id) return node;
		const match = findNode(node.children, id);
		if (match) return match;
	}
	return null;
}
/** finds the parent of a node by id (null for roots / not found) */
function findParent(nodes, id) {
	for (const node of nodes) {
		if (node.children.some((child) => child.id === id)) return node;
		const match = findParent(node.children, id);
		if (match) return match;
	}
	return null;
}
/** true when the node with `id` has an ancestor of the given type */
function hasAncestorOfType(nodes, id, type) {
	for (const node of nodes) {
		if (node.type === type && findNode(node.children, id)) return true;
		if (hasAncestorOfType(node.children, id, type)) return true;
	}
	return false;
}
//#endregion
//#region src/lib/components.ts
/**
* Deep-clone a subtree into the master id space: fresh ids, line info dropped,
* and interaction/animation binding `targetId`s that point INSIDE the subtree
* rewritten onto the new ids — without the rewrite every internal binding
* (a modal's close button, an accordion trigger) keeps aiming at the PAGE
* node ids and goes dead the moment the block becomes a component.
* Returns the clone plus the old→new id map (the key set doubles as "which
* page ids are inside the extracted subtree" for outside-target detection).
*/
function cloneForMaster(source) {
	const cloned = JSON.parse(JSON.stringify(source));
	const idMap = /* @__PURE__ */ new Map();
	walkNodes([cloned], (n) => {
		const next = crypto.randomUUID();
		idMap.set(n.id, next);
		n.id = next;
		delete n.line;
		delete n.endLine;
		delete n.ref;
	});
	walkNodes([cloned], (n) => {
		for (const b of n.interactions ?? []) if (b.targetId && idMap.has(b.targetId)) b.targetId = idMap.get(b.targetId);
		for (const b of n.animations ?? []) if (b.targetId && idMap.has(b.targetId)) b.targetId = idMap.get(b.targetId);
	});
	return {
		cloned,
		idMap
	};
}
/**
* After extraction the MASTER owns the subtree's presentation and content —
* clear the source nodes' node-only state so the new instance INHERITS instead
* of shadowing. A shadow looks identical at extraction time but bites later:
* shared chrome gets translated once per page, and a master restructure can
* re-seat the stale override onto the wrong node. `htmlId` stays (a per-page
* anchor), `arg`/`link` stay (code-owned).
*/
function stripExtractedInstanceState(source) {
	walkNodes([source], (n) => {
		delete n.classes;
		delete n.interactions;
		delete n.animations;
		delete n.attributes;
		delete n.src;
		delete n.background;
		delete n.locales;
		delete n.content;
	});
}
/** component types are Capitalized in the syntax; built-ins stay lowercase */
function isComponentType(type) {
	return /^[A-Z]/.test(type);
}
/** turns raw user input into a valid, unique component name ('my card' → 'MyCard') */
function normalizeComponentName(raw, taken) {
	const cleaned = raw.split(/[^a-zA-Z0-9]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
	const base = /^[A-Za-z]/.test(cleaned) ? cleaned : `C${cleaned}`;
	const name = base.charAt(0).toUpperCase() + base.slice(1) || "Component";
	if (!taken.includes(name)) return name;
	let n = 2;
	while (taken.includes(`${name}${n}`)) n++;
	return `${name}${n}`;
}
/** serializes a master node back into syntax lines at the given indent —
* including its code-owned decorations: the [arg] binding and the @link
* suffix (dropping them would strip bindings/links from every instance on
* each structure rewrite) */
function serializeNode(node, indent) {
	const arg = node.arg ? `[${node.arg}]` : "";
	const link = node.link ? `@${node.link === "@item" ? "item" : node.link}` : "";
	if (isLeafElement(node.type)) return [`${indent}:${node.type}${arg}:${link}`];
	return [
		`${indent}:${node.type}${arg}${link}`,
		...node.children.flatMap((child) => serializeNode(child, `${indent}\t`)),
		`${indent}${node.type}:`
	];
}
/**
* Extraction helper: refs on the lines about to be wrapped in ':Name … Name:'.
*
* The block ROOT's ref is hoisted onto the wrapper — the instance root is a
* real page node, so it keeps its address — and every ref BELOW it is dropped,
* because those lines become the master's structure and get rewritten into
* every instance. Shared by the editor's createComponent and MCP's
* makeComponentFrom so the two can't drift.
*/
function hoistBlockRef(innerLines) {
	return {
		ref: refOf(innerLines[0] ?? ""),
		lines: innerLines.map(withoutRef)
	};
}
/** a node's SHALLOW code identity — the DSL its own line encodes: type, the
* [arg] binding, the @link. Deliberately NOT recursive: matching is done one
* level at a time (like the page reconciler matching by line), so a container
* keeps its identity even when its children change, while its children realign
* among themselves. Classes/content/interactions are excluded — they are the
* off-code state we're carrying across the edit. Two `:link:@/a` and
* `:link:@/b` get distinct signatures; two bare `:link:` are genuinely
* indistinguishable (no algorithm can tell which identical sibling was
* removed — same irreducible case the reconciler faces). */
function nodeSignature(node) {
	return `${node.type}|${node.arg ?? ""}|${node.link ?? ""}`;
}
/** longest-common-subsequence alignment of two signature lists → a map from
* b-index to the a-index it matches. Same primitive the page reconciler uses,
* so component adoption and page edits carry identity the same way — a removed
* sibling no longer shifts the survivors onto the wrong master nodes. */
function lcsAlign(a, b) {
	const n = a.length;
	const m = b.length;
	const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
	const map = /* @__PURE__ */ new Map();
	let i = 0;
	let j = 0;
	while (i < n && j < m) if (a[i] === b[j]) {
		map.set(j, i);
		i++;
		j++;
	} else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
	else j++;
	return map;
}
/** a line's token type: `:h1[x]:(+)` → ':h1', a closer `section:` → 'section:' */
function lineTypeSig(line) {
	const t = line.trim();
	const open = t.match(/^:([A-Za-z][A-Za-z0-9-]*)/);
	if (open) return `:${open[1]}`;
	const close = t.match(/^([A-Za-z][A-Za-z0-9-]*):$/);
	return close ? `${close[1]}:` : t;
}
/**
* Align an instance block's OLD inner lines to the freshly serialized NEW ones
* (map: newIndex → oldIndex, both relative to the block). Exact-text LCS
* first, then a weak pass matching leftover lines by token TYPE in order —
* so a master edit that inserts a node or tweaks a link/arg keeps every other
* instance node (and its per-instance content overrides) on the line it came
* from, instead of the pure positional map re-seating everything after the
* insertion one node off.
*/
function alignInstanceLines(oldLines, newLines) {
	const matches = lcsAlign(oldLines.map((l) => l.trim()), newLines.map((l) => l.trim()));
	const used = new Set(matches.values());
	const freeOld = oldLines.map((_, i) => i).filter((i) => !used.has(i));
	const freeNew = newLines.map((_, i) => i).filter((i) => !matches.has(i));
	if (freeOld.length && freeNew.length) {
		const weak = lcsAlign(freeOld.map((i) => lineTypeSig(oldLines[i])), freeNew.map((i) => lineTypeSig(newLines[i])));
		for (const [nj, oj] of weak) matches.set(freeNew[nj], freeOld[oj]);
	}
	return matches;
}
/**
* Re-derive a component master's children from an edited instance's subtree,
* CARRYING node identity (id/classes/content/interactions) wherever the code
* structure still lines up, minting fresh nodes only for genuinely new code.
*
* Matching is by code signature (type + arg + link + child structure) aligned
* with an LCS — NOT greedy first-match-by-type, which silently re-seated a
* survivor onto a removed sibling's master node (dragging its classes and
* interaction bindings along) whenever a same-type child was deleted.
*
* `arg`/`link` are code-owned, so the edited block is authoritative for them.
* Fills `result` with the adopt/create counts and any orphaned master nodes.
*/
function adoptStructure(master, edited, selfName, result = {
	adopted: 0,
	created: 0,
	orphaned: []
}) {
	const masterChildren = master.children;
	const editedChildren = edited.children.filter((child) => child.type !== selfName);
	const matches = lcsAlign(masterChildren.map(nodeSignature), editedChildren.map(nodeSignature));
	const weakSignature = (n) => `${n.type}|${n.arg ?? ""}`;
	const freeMaster = masterChildren.map((_, i) => i).filter((i) => ![...matches.values()].includes(i));
	const freeEdited = editedChildren.map((_, i) => i).filter((i) => !matches.has(i));
	if (freeMaster.length && freeEdited.length) {
		const weak = lcsAlign(freeMaster.map((i) => weakSignature(masterChildren[i])), freeEdited.map((i) => weakSignature(editedChildren[i])));
		for (const [ej, mj] of weak) matches.set(freeEdited[ej], freeMaster[mj]);
	}
	const usedMaster = new Set(matches.values());
	master.children = editedChildren.map((child, ei) => {
		const mi = matches.get(ei);
		let node;
		if (mi !== void 0) {
			node = masterChildren[mi];
			result.adopted++;
		} else {
			node = {
				id: crypto.randomUUID(),
				type: child.type,
				content: child.content,
				locales: child.locales ? JSON.parse(JSON.stringify(child.locales)) : void 0,
				attributes: child.attributes ? JSON.parse(JSON.stringify(child.attributes)) : void 0,
				children: []
			};
			result.created++;
		}
		if (child.arg) node.arg = child.arg;
		else delete node.arg;
		if (child.link) node.link = child.link;
		else delete node.link;
		adoptStructure(node, child, selfName, result);
		return node;
	});
	masterChildren.forEach((m, mi) => {
		if (usedMaster.has(mi)) return;
		result.orphaned.push({
			id: m.id,
			type: m.type,
			hadClasses: !!m.classes?.trim(),
			hadInteractions: (m.interactions?.length ?? 0) + (m.animations?.length ?? 0)
		});
	});
	return result;
}
/**
* Expands freshly typed component references into their full editable
* block: a `:Card:` leaf, or an empty `:Card` / `Card:` pair, becomes
* `:Card` + the master's structure + `Card:`.
*/
function expandComponentInstances(code, components, lineMap) {
	if (!components.length) {
		if (lineMap) code.split("\n").forEach((_, i) => lineMap.push(i));
		return code;
	}
	const lines = code.split("\n");
	const out = [];
	const mark = () => lineMap?.push(out.length);
	/** component blocks currently open — a component never expands inside itself */
	const stack = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		const indent = line.match(/^\t*/)[0];
		const close = trimmed.match(/^([A-Z][a-zA-Z0-9-]*):$/);
		if (close && stack[stack.length - 1] === close[1]) {
			stack.pop();
			mark();
			out.push(line);
			continue;
		}
		const leaf = trimmed.match(/^:([A-Z][a-zA-Z0-9-]*):$/);
		const leafDef = leaf ? components.find((c) => c.name === leaf[1]) : null;
		if (leafDef && !stack.includes(leafDef.name)) {
			mark();
			out.push(`${indent}:${leafDef.name}`);
			out.push(...leafDef.root.children.flatMap((c) => serializeNode(c, `${indent}\t`)));
			out.push(`${indent}${leafDef.name}:`);
			continue;
		}
		const open = trimmed.match(/^:([A-Z][a-zA-Z0-9-]*)$/);
		const openDef = open ? components.find((c) => c.name === open[1]) : null;
		if (openDef && !stack.includes(openDef.name) && lines[i + 1]?.trim() === `${openDef.name}:`) {
			mark();
			out.push(line);
			out.push(...openDef.root.children.flatMap((c) => serializeNode(c, `${indent}\t`)));
			mark();
			out.push(lines[i + 1]);
			i++;
			continue;
		}
		if (open) stack.push(open[1]);
		mark();
		out.push(line);
	}
	return out.join("\n");
}
//#endregion
//#region src/lib/syntax.ts
var REF = "(?:#(?<ref>[a-zA-Z][a-zA-Z0-9-]*)?)?";
/** the same slot, uncaptured — for head-anchored matchers that only need to
* SKIP it. Exported so line-patching callers (setElementArg, setElementRef)
* share this one definition instead of each re-spelling the ref grammar. */
var REF_SLOT = "(?:#[a-zA-Z0-9-]*)?";
var NAME = "[a-zA-Z][a-zA-Z0-9-]*";
var ARG = "(?:\\[(?<arg>[a-z0-9.@+-]*)\\]?)?";
var MARKERS = "(?:\\(\\+?\\)?)?(?:\\{\\+?\\}?)?";
var LINK = "(?:@(?<link>\\S+))?";
var LEAF = new RegExp(`^:(?<name>${NAME})${REF}${ARG}${MARKERS}:${LINK}$`);
var OPEN = new RegExp(`^:(?<name>${NAME})${REF}${ARG}${MARKERS}${LINK}$`);
var CLOSE = /^([a-zA-Z][a-zA-Z0-9-]*):$/;
/** the named slots of a LEAF/OPEN match. Every consumer reads the token through
* this, so adding a slot is a change in exactly one place. */
function slots(m) {
	const g = m.groups;
	return {
		name: g.name,
		ref: g.ref,
		arg: g.arg,
		link: g.link
	};
}
/** the '#ref' a line's token carries, or undefined. Reads the code, not a node —
* callers patching a line need this before the tree has been re-derived. */
function refOf(line) {
	const trimmed = line.trim();
	const m = trimmed.match(LEAF) ?? trimmed.match(OPEN);
	return m ? slots(m).ref : void 0;
}
/** the same line with its '#ref' removed. No-ops on close lines and on lines
* that never had one. */
function withoutRef(line) {
	return line.replace(new RegExp(`^(\\s*:${NAME})${REF_SLOT}`), "$1");
}
/** the '@target' suffix a node carries in code → its node.link value
* ('item' is the current-entry sentinel, stored as '@item'; else verbatim) */
function linkFromToken(target) {
	if (!target) return void 0;
	return target === "item" ? "@item" : target;
}
var tabs = (n) => "	".repeat(n);
/**
* Splits a line's content into individual syntax tokens, including
* glued ones: ':div:h1:' → [':div', ':h1:']. A trailing ':' only
* closes a leaf when it isn't the start of the next token.
*/
function lexLine(text) {
	const tokens = [];
	let i = 0;
	while (i < text.length) {
		while (i < text.length && /\s/.test(text[i])) i++;
		if (i >= text.length) break;
		let j = i;
		if (text[j] === ":") {
			j++;
			while (j < text.length && /[a-zA-Z0-9-]/.test(text[j])) j++;
			if (text[j] === "#") {
				j++;
				while (j < text.length && /[a-zA-Z0-9-]/.test(text[j])) j++;
			}
			if (text[j] === "[") {
				let k = j + 1;
				while (k < text.length && /[a-z0-9.@+-]/.test(text[k])) k++;
				j = text[k] === "]" ? k + 1 : k;
			}
			if (text[j] === "(") {
				j++;
				if (text[j] === "+") j++;
				if (text[j] === ")") j++;
			}
			if (text[j] === "{") {
				j++;
				if (text[j] === "+") j++;
				if (text[j] === "}") j++;
			}
			if (text[j] === ":" && !/[a-zA-Z]/.test(text[j + 1] ?? "")) j++;
			if (text[j] === "@") {
				j++;
				while (j < text.length && !/\s/.test(text[j])) j++;
			}
		} else {
			while (j < text.length && /[a-zA-Z0-9-]/.test(text[j])) j++;
			if (text[j] === ":") j++;
		}
		if (j === i) j++;
		tokens.push(text.slice(i, j));
		i = j;
	}
	return tokens;
}
var TOKEN_HEAD = new RegExp(`^(\\s*:${NAME}${REF_SLOT}(?:\\[[a-z0-9.@+-]*\\])?)(\\(\\+?\\)?)?`);
/** the :body wrapper's open line — tolerates an arg and (possibly mid-typing)
* style/interaction markers: ':body', ':body[post]', ':body(', ':body[post](+){+}'.
* Every scaffold matcher must use this so a '(' typed on the body line can't
* make the wrapper look damaged (which would respawn a fresh :body). */
var isBodyOpenLine = (trimmed) => /^:body(?:$|[[({])/.test(trimmed);
/** the marker currently on the line's token: '(+)', or a mid-typing '(', '(+', '()' */
function styleMarkerOf(line) {
	return line.match(TOKEN_HEAD)?.[2] || void 0;
}
/** the line's token has an unclosed '[' arg — an arg edit in progress */
function hasOpenArgBracket(line) {
	return new RegExp(`^\\s*:${NAME}${REF_SLOT}\\[[^\\]]*$`).test(line);
}
/** rewrites the line's styled marker: on → exactly '(+)', off → none.
* No-ops on lines that don't start with an element token (close lines, @setup).
* An existing '{+}' stays in the rest, so ordering '(+){+}' falls out for free. */
function withStyleMarker(line, on) {
	const m = line.match(TOKEN_HEAD);
	if (!m || !m[1]) return line;
	const head = m[1];
	const rest = line.slice(head.length + (m[2]?.length ?? 0));
	return head + (on ? "(+)" : "") + rest;
}
var INT_HEAD = new RegExp(`^(\\s*:${NAME}${REF_SLOT}(?:\\[[a-z0-9.@+-]*\\])?(?:\\(\\+?\\)?)?)(\\{\\+?\\}?)?`);
/** the interactions marker currently on the line's token: '{+}', or a
* mid-typing '{', '{+', '{}' */
function interactionMarkerOf(line) {
	return line.match(INT_HEAD)?.[2] || void 0;
}
/** rewrites the line's interactions marker: on → exactly '{+}', off → none */
function withInteractionMarker(line, on) {
	const m = line.match(INT_HEAD);
	if (!m || !m[1]) return line;
	const head = m[1];
	const rest = line.slice(head.length + (m[2]?.length ?? 0));
	return head + (on ? "{+}" : "") + rest;
}
var DATA_HEAD = new RegExp(`^(\\s*:${NAME}${REF_SLOT})(\\[[a-z0-9.@+-]*\\]?)?`);
/** the data marker currently on the line's token — only '[+]' counts; a real
* arg or a mid-typing '[' is not a marker */
function dataMarkerOf(line) {
	const slot = line.match(DATA_HEAD)?.[2];
	return slot === "[+]" ? slot : void 0;
}
/** rewrites the line's data marker: on → exactly '[+]', off → none.
* No-ops when the slot holds a real '[arg]' (bindings own the slot) or an
* unclosed '[' (an arg edit in progress). */
function withDataMarker(line, on) {
	const m = line.match(DATA_HEAD);
	if (!m || !m[1]) return line;
	const slot = m[2];
	if (slot && slot !== "[+]") return line;
	const rest = line.slice(m[1].length + (slot?.length ?? 0));
	return m[1] + (on ? "[+]" : "") + rest;
}
/**
* Enforces one syntax token per line AND forces indentation from the token
* structure: every line is re-indented to its nesting depth — one deeper
* after an open, one shallower before a close — so whatever tabs the author
* typed are overridden by the true structure. Runs on body content only
* (called from enforceDocument), which sits one level inside :body, so depth
* starts at 1. Blank lines are dropped entirely: deleting a line's token
* removes the line rather than leaving a stranded empty line behind. (The
* empty-body placeholder is re-added by buildDocument.)
*/
function opensDepth(name) {
	return isComponentType(name) || isKnownElement(name) && name !== "body" && !isLeafElement(name);
}
function normalizeSyntax(value) {
	const out = [];
	let depth = 1;
	for (const original of value.split("\n")) {
		const trimmed = original.trim();
		if (!trimmed) continue;
		for (const token of lexLine(trimmed)) {
			const close = token.match(CLOSE);
			if (close && opensDepth(close[1])) depth = Math.max(1, depth - 1);
			out.push(tabs(depth) + token);
			const open = token.match(OPEN);
			if (open && opensDepth(slots(open).name)) depth += 1;
		}
	}
	return out.join("\n");
}
/**
* Parses the page syntax into an element tree.
*
*   :section        open
*     :h1:          leaf (self-closing)
*   section:        close
*
* Unknown element names and stray lines are ignored so the
* tree stays valid while the user is mid-typing.
*/
function parseSyntax(code, adopt) {
	const root = [];
	const stack = [];
	const built = /* @__PURE__ */ new Map();
	const append = (node) => {
		const parent = stack[stack.length - 1];
		(parent ? built.get(parent) : root).push(node);
	};
	const nodeFor = (line, type) => {
		const existing = adopt?.(line, type, stack[stack.length - 1] ?? null) ?? createNode(type);
		built.set(existing, []);
		return existing;
	};
	const lines = code.split("\n");
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) for (const token of lexLine(lines[lineIndex].trim())) {
		const leaf = token.match(LEAF);
		if (leaf) {
			const { name, ref, arg, link } = slots(leaf);
			if (isKnownElement(name) || isComponentType(name)) {
				const node = nodeFor(lineIndex, name);
				node.line = node.endLine = lineIndex;
				node.arg = arg && arg !== "+" ? arg : void 0;
				node.ref = ref;
				node.link = linkFromToken(link);
				append(node);
			}
			continue;
		}
		const open = token.match(OPEN);
		if (open) {
			const { name, ref, arg, link } = slots(open);
			if (isKnownElement(name) || isComponentType(name)) {
				const node = nodeFor(lineIndex, name);
				node.line = node.endLine = lineIndex;
				node.arg = arg && arg !== "+" ? arg : void 0;
				node.ref = ref;
				node.link = linkFromToken(link);
				append(node);
				stack.push(node);
			}
			continue;
		}
		const close = token.match(CLOSE);
		if (close) {
			for (let i = stack.length - 1; i >= 0; i--) if (stack[i].type === close[1]) {
				for (let j = i; j < stack.length; j++) stack[j].endLine = lineIndex;
				stack.length = i;
				break;
			}
		}
	}
	for (const node of stack) node.endLine = lines.length - 1;
	for (const [node, kids] of built) {
		const prev = node.children;
		if (!(prev && prev.length === kids.length && kids.every((child, i) => child === prev[i]))) node.children = kids;
	}
	return root;
}
/**
* Maps each line of the new code to the line of the old code it came from.
* Lines that were inserted or rewritten have no mapping.
*
* Patience-style: byte-identical prefix/suffix are mapped directly, then
* lines UNIQUE in both remainders anchor the alignment (longest increasing
* subsequence keeps crossings out) and the segments between anchors recurse.
* Plain LCS runs only inside segments with no anchors. A pure LCS over the
* whole document is ambiguous on this DSL's highly repetitive lines (`:div`,
* `div:`, …): a mid-document insertion could shift the alignment and pair
* surviving nodes with the WRONG downstream lines, silently reassigning
* their classes/content/bindings (the reconciler adopts by mapped line).
*/
/** a line reduced to what the author MEANS: display-only markers ('(+)',
* '{+}', '[+]') and trailing whitespace stripped. The diff compares canonical
* lines so a caller that submits marker-stripped code (markers are derived
* state, so stripping them is a reasonable thing to do) still maps every
* surviving line — raw comparison made every styled line a mismatch and
* silently re-seated classes/content on the wrong nodes. */
function canonicalLine(line) {
	return withDataMarker(withInteractionMarker(withStyleMarker(line, false), false), false).replace(/\s+$/, "");
}
function lineMap(oldCode, newCode) {
	const a = oldCode.split("\n").map(canonicalLine);
	const b = newCode.split("\n").map(canonicalLine);
	const map = /* @__PURE__ */ new Map();
	mapRange(a, b, 0, a.length, 0, b.length, map);
	return map;
}
/** classic LCS alignment over a slice — the anchorless fallback */
function lcsRange(a, b, aLo, aHi, bLo, bHi, map) {
	const n = aHi - aLo;
	const m = bHi - bLo;
	if (n <= 0 || m <= 0) return;
	const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[aLo + i] === b[bLo + j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
	let i = 0;
	let j = 0;
	while (i < n && j < m) if (a[aLo + i] === b[bLo + j]) {
		map.set(bLo + j, aLo + i);
		i++;
		j++;
	} else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
	else j++;
}
function mapRange(a, b, aLo, aHi, bLo, bHi, map) {
	while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
		map.set(bLo, aLo);
		aLo++;
		bLo++;
	}
	while (aHi > aLo && bHi > bLo && a[aHi - 1] === b[bHi - 1]) {
		aHi--;
		bHi--;
		map.set(bHi, aHi);
	}
	if (aLo >= aHi || bLo >= bHi) return;
	const occurrences = (lines, lo, hi) => {
		const m = /* @__PURE__ */ new Map();
		for (let i = lo; i < hi; i++) {
			const e = m.get(lines[i]);
			if (e) e.n++;
			else m.set(lines[i], {
				n: 1,
				at: i
			});
		}
		return m;
	};
	const inA = occurrences(a, aLo, aHi);
	const inB = occurrences(b, bLo, bHi);
	const pairs = [];
	for (const [line, eb] of inB) {
		if (eb.n !== 1) continue;
		const ea = inA.get(line);
		if (ea?.n === 1) pairs.push([ea.at, eb.at]);
	}
	if (!pairs.length) return lcsRange(a, b, aLo, aHi, bLo, bHi, map);
	pairs.sort((x, y) => x[1] - y[1]);
	const tailAt = [];
	const prev = new Array(pairs.length).fill(-1);
	for (let p = 0; p < pairs.length; p++) {
		const ai = pairs[p][0];
		let lo = 0;
		let hi = tailAt.length;
		while (lo < hi) {
			const mid = lo + hi >> 1;
			if (pairs[tailAt[mid]][0] < ai) lo = mid + 1;
			else hi = mid;
		}
		if (lo > 0) prev[p] = tailAt[lo - 1];
		tailAt[lo] = p;
	}
	const chain = [];
	for (let p = tailAt.length ? tailAt[tailAt.length - 1] : -1; p !== -1; p = prev[p]) chain.push(pairs[p]);
	chain.reverse();
	let prevA = aLo;
	let prevB = bLo;
	for (const [ai, bi] of chain) {
		mapRange(a, b, prevA, ai, prevB, bi, map);
		map.set(bi, ai);
		prevA = ai + 1;
		prevB = bi + 1;
	}
	mapRange(a, b, prevA, aHi, prevB, bHi, map);
}
/** the node-only state a node carries that is NOT derivable from the code.
* Shared by the reparent guard and by callers that want a clean slate. */
var NODE_STATE_KEYS = [
	"classes",
	"content",
	"src",
	"background",
	"htmlId",
	"attributes",
	"interactions",
	"animations",
	"locales",
	"listQuery",
	"entryId",
	"slider"
];
/** true when a node carries state that would be lost (or wrongly inherited) */
function hasNodeState(node) {
	return NODE_STATE_KEYS.some((key) => {
		const value = node[key];
		if (value == null || value === "") return false;
		if (Array.isArray(value)) return value.length > 0;
		if (typeof value === "object") return Object.keys(value).length > 0;
		return true;
	});
}
/** drop everything a node carried, leaving the structure the code describes */
function stripNodeState(node) {
	for (const key of NODE_STATE_KEYS) delete node[key];
}
/**
* Every unique `#ref` in the code → the line and element type carrying it.
* A ref used TWICE maps to null: an ambiguous ref gets no special treatment
* (validateDocument flags it; reconcile just falls back to the line diff).
*/
function refLines(code) {
	const found = /* @__PURE__ */ new Map();
	const lines = code.split("\n");
	for (let i = 0; i < lines.length; i++) for (const token of lexLine(lines[i].trim())) {
		const m = token.match(LEAF) ?? token.match(OPEN);
		if (!m) continue;
		const { name, ref } = slots(m);
		if (!ref) continue;
		found.set(ref, found.has(ref) ? null : {
			line: i,
			type: name
		});
	}
	return found;
}
function reconcile(oldCode, newCode, previous, map, stats, opts = {}) {
	const derived = map === void 0;
	const lineMapping = map ?? lineMap(oldCode, newCode);
	const byOldLine = /* @__PURE__ */ new Map();
	const parentOf = /* @__PURE__ */ new Map();
	const indexTree = (nodes, parentId) => {
		for (const node of nodes) {
			parentOf.set(node.id, parentId);
			indexTree(node.children ?? [], node.id);
		}
	};
	indexTree(previous, null);
	walkNodes(previous, (node) => {
		if (node.line === void 0) return;
		const list = byOldLine.get(node.line) ?? [];
		list.push(node);
		byOldLine.set(node.line, list);
	});
	if (derived) {
		const oldRefs = refLines(oldCode);
		const takenOldLines = new Set(lineMapping.values());
		for (const [ref, here] of refLines(newCode)) {
			if (!here || lineMapping.has(here.line)) continue;
			const there = oldRefs.get(ref);
			if (!there || there.type !== here.type || takenOldLines.has(there.line)) continue;
			lineMapping.set(here.line, there.line);
			takenOldLines.add(there.line);
		}
	}
	const mappedOldLines = new Set(lineMapping.values());
	return parseSyntax(newCode, (line, type, parent) => {
		const oldLine = lineMapping.get(line) ?? (mappedOldLines.has(line) ? void 0 : line);
		const candidates = oldLine === void 0 ? void 0 : byOldLine.get(oldLine);
		const at = candidates?.findIndex((n) => n.type === type) ?? -1;
		if (at === -1) {
			if (stats) stats.created++;
			return null;
		}
		if (stats) stats.adopted++;
		const node = candidates.splice(at, 1)[0];
		if (opts.guardReparent && parentOf.get(node.id) !== (parent?.id ?? null)) {
			if (hasNodeState(node)) {
				stats?.reparented?.push({
					id: node.id,
					type: node.type
				});
				stripNodeState(node);
			}
		}
		return node;
	});
}
/** list sources that are not collections: `:collection-list[@pages]` repeats
* over the site's own published pages (see shared/fields.pagesListScope) */
var BUILTIN_LIST_SOURCES = ["@pages"];
/** Flags unclosed elements, unknown components, and unknown collections */
function validateDocument(code, componentNames = [], collectionNames = [], listFieldNames = [], dataOnlyCollections = []) {
	const lines = code.split("\n");
	const trimmed = lines.map((l) => l.trim());
	const start = trimmed.findIndex(isBodyOpenLine);
	const end = trimmed.lastIndexOf("body:");
	const diags = [];
	const bodyRef = trimmed.findIndex((l) => /^:body#/.test(l));
	if (bodyRef !== -1) diags.push({
		line: bodyRef,
		message: "':body' can't carry a '#ref' — it is the page root and is already addressable"
	});
	if (start === -1 || end <= start) return diags;
	const stack = [];
	/** every '#ref' seen so far → the line that claimed it, for the duplicate check */
	const refAt = /* @__PURE__ */ new Map();
	for (let i = start + 1; i < end; i++) {
		const lineTokens = lexLine(trimmed[i]);
		if (!lineTokens.length) continue;
		const indent = lines[i].length - lines[i].trimStart().length;
		const firstClose = lineTokens[0].match(CLOSE);
		while (stack.length) {
			const top = stack[stack.length - 1];
			if (indent > top.indent) break;
			if (firstClose && firstClose[1] === top.type && indent <= top.indent) break;
			diags.push({
				line: top.line,
				message: `':${top.type}' is never closed — line ${i + 1} returns to its indentation level before a matching '${top.type}:'. Add '${top.type}:' after its children (for an empty decorative container, put '${top.type}:' on the very next line)`
			});
			stack.pop();
		}
		for (const token of lineTokens) {
			const leaf = token.match(LEAF);
			const open = token.match(OPEN);
			const close = token.match(CLOSE);
			const part = leaf ? slots(leaf) : open ? slots(open) : null;
			const name = part?.name;
			if (part?.ref) {
				const first = refAt.get(part.ref);
				if (first !== void 0) diags.push({
					line: i,
					message: `'#${part.ref}' is already used on line ${first + 1} — refs must be unique on a page`
				});
				else refAt.set(part.ref, i);
				const inInstance = stack.find((sc) => componentNames.includes(sc.type));
				if (inInstance) diags.push({
					line: i,
					message: `'#${part.ref}' is inside the ':${inInstance.type}' component block — refs are page-scope, and a component's structure is copied into every instance. Put the ref on the ':${inInstance.type}' line instead.`
				});
			}
			if (name === "collection-list" || name === "collection-item") {
				const arg = part?.arg;
				if (!(!!arg && (collectionNames.includes(arg) || name === "collection-list" && BUILTIN_LIST_SOURCES.includes(arg) || name === "collection-list" && listFieldNames.includes(arg)))) diags.push({
					line: i,
					message: `Unknown collection ':${name}[${arg ?? ""}]'`
				});
				else if (open) stack.push({
					type: name,
					line: i,
					indent,
					arg
				});
				continue;
			}
			if (name === "slider") {
				const arg = part?.arg;
				if (arg && !collectionNames.includes(arg) && !BUILTIN_LIST_SOURCES.includes(arg) && !listFieldNames.includes(arg)) diags.push({
					line: i,
					message: `Unknown collection ':slider[${arg}]'`
				});
				else if (leaf) diags.push({
					line: i,
					message: "':slider:' is a container — open it as ':slider … slider:'"
				});
				else if (open) stack.push({
					type: name,
					line: i,
					indent,
					arg
				});
				continue;
			}
			if (linkFromToken(part?.link) === "@item") {
				const scope = [...stack].reverse().find((s) => s.arg && collectionNames.includes(s.arg));
				if (scope && dataOnlyCollections.includes(scope.arg)) diags.push({
					line: i,
					message: `'@item' links to an entry's own page, but the collection '${scope.arg}' has no detail routes (detailRoutes: false). Remove the link, or give the collection a template page.`
				});
			}
			if (name && isComponentType(name)) {
				if (!componentNames.includes(name)) diags.push({
					line: i,
					message: `Unknown component ':${name}${leaf ? ":" : ""}'`
				});
				else if (stack.some((s) => s.type === name)) diags.push({
					line: i,
					message: `':${name}${leaf ? ":" : ""}' can't contain itself`
				});
				else if (open) stack.push({
					type: name,
					line: i,
					indent
				});
				continue;
			}
			if (name && isKnownElement(name) && name !== "body") {
				if (open && isLeafElement(name)) diags.push({
					line: i,
					message: `':${name}' is a leaf — write it as ':${name}:'`
				});
				else if (leaf && !isLeafElement(name)) diags.push({
					line: i,
					message: `':${name}:' is a container — open it as ':${name} … ${name}:'`
				});
				else if (open) stack.push({
					type: name,
					line: i,
					indent
				});
				continue;
			}
			if (close) {
				for (let j = stack.length - 1; j >= 0; j--) if (stack[j].type === close[1]) {
					stack.length = j;
					break;
				}
				continue;
			}
			diags.push({
				line: i,
				message: `Invalid syntax '${token}'`
			});
		}
	}
	return diags.concat(stack.map((s) => ({
		line: s.line,
		message: `Close ':${s.type}' with '${s.type}:'`
	}))).sort((a, b) => a.line - b.line);
}
/** Elements that carry content/void render as leaves (:h1:), the rest open a block (:div) */
function tokenFor(type) {
	return isLeafElement(type) ? `:${type}:` : `:${type}`;
}
/**
* Dedented source lines for a brand-new element of the given type. A seeded
* container (a button, a link) is born holding its child, so an insert lands
* something visible rather than an empty box — the child's TEXT is node state
* and is applied by the caller (`applySeedContent`), not carried by the code.
*/
function elementBlockLines(type) {
	const token = tokenFor(type);
	if (token.endsWith(":")) return [token];
	const seed = ELEMENTS[type]?.seed;
	if (seed) return [
		token,
		`\t${tokenFor(seed.type)}`,
		`${type}:`
	];
	return [token, `${type}:`];
}
//#endregion
//#region src/lib/shared/slug.js
/**
* normalizes a string into a url slug segment
* @param {string} value
* @returns {string}
*/
function slugify(value) {
	return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
//#endregion
//#region src/lib/document.ts
/**
* Canonical page document: a protected @setup block, then the :body
* wrap — body: is always the last line. Only the setup values and the
* body content are editable; an empty body keeps one indented line so
* there is always somewhere to type.
*/
function buildDocument(meta, bodyLines, bodyArg, bodyDecor) {
	const body = bodyLines.some((l) => l.trim()) ? bodyLines : ["	"];
	return [
		"@setup",
		`\tname: ${meta.name}`,
		`\tslug: ${meta.slug}`,
		`\tstatus: ${meta.status}`,
		`\tlocale: ${meta.locale}`,
		(bodyArg ? `:body[${bodyArg}]` : ":body") + (bodyDecor ?? ""),
		...body,
		"body:"
	].join("\n");
}
/** the collection bound to the page body, from :body[post] (markers after
* the arg are tolerated: ':body[post](+)') */
function extractBodyArg(code) {
	return code.match(/^:body\[([a-z0-9-]+)\](?:[({].*)?$/m)?.[1];
}
/** the style/interaction markers on the :body line — possibly mid-typing
* ('(', '(+'…) — round-tripped through rebuilds so typing '(' on body (which
* opens the Style panel) and the synced '(+)'/'{+}' markers survive the
* scaffold enforcement instead of respawning a fresh :body */
function extractBodyDecor(code) {
	return code.split("\n").map((l) => l.trim()).find(isBodyOpenLine)?.match(/^:body(?:\[[a-z0-9-]*\]?)?((?:\(\+?\)?)?(?:\{\+?\}?)?)$/)?.[1] || void 0;
}
/** rebuilds a document with new @setup values but the same body */
function replaceSetup(code, meta) {
	return buildDocument(meta, extractBodyLines(code), extractBodyArg(code), extractBodyDecor(code));
}
/** The editable lines between :body and body: */
function extractBodyLines(code) {
	const lines = code.split("\n");
	const trimmed = lines.map((l) => l.trim());
	const start = trimmed.findIndex(isBodyOpenLine);
	const end = trimmed.lastIndexOf("body:");
	if (start !== -1 && end > start) return lines.slice(start + 1, end);
	return lines.filter((l) => {
		const t = l.trim();
		return t && !t.startsWith("@") && !/^(name|slug|status|locale):/.test(t) && !isBodyOpenLine(t) && t !== "body:";
	});
}
/**
* Rebuilds the canonical document from whatever the user typed:
* the scaffold always comes back, setup values and body content
* survive. Returns the enforced code plus the parsed meta.
*/
/** reads the @setup values out of a document */
function parseSetup(value) {
	return {
		name: value.match(/^\s*name: ?(.*)$/m)?.[1] ?? "",
		slug: value.match(/^\s*slug: ?(.*)$/m)?.[1] ?? "",
		status: value.match(/^\s*status: ?(.*)$/m)?.[1] || "published",
		locale: value.match(/^\s*locale: ?(.*)$/m)?.[1] || "en"
	};
}
/**
* Rewrites the locale value on the @setup line only — never body lines
* (a body line could trim to `locale: x`). Zero line-count change.
*/
function setSetupLocale(code, locale) {
	const lines = code.split("\n");
	const bodyOpen = lines.findIndex((l) => isBodyOpenLine(l.trim()));
	const end = bodyOpen === -1 ? lines.length : bodyOpen;
	for (let i = 1; i < end; i++) if (/^\s*locale:/.test(lines[i])) {
		lines[i] = lines[i].replace(/^(\s*locale: ?).*$/, `$1${locale}`);
		return lines.join("\n");
	}
	return code;
}
function enforceDocument(value) {
	const meta = parseSetup(value);
	return {
		code: buildDocument(meta, normalizeSyntax(extractBodyLines(value).join("\n")).split("\n").map((l) => l.trim() && !l.startsWith("	") ? "	" + l : l), extractBodyArg(value), extractBodyDecor(value)),
		meta
	};
}
//#endregion
//#region src/lib/colors.ts
var TAILWIND_SHADES = [
	"50",
	"100",
	"200",
	"300",
	"400",
	"500",
	"600",
	"700",
	"800",
	"900"
];
/** hex values per color, index-aligned with TAILWIND_SHADES */
var TAILWIND_COLORS = {
	slate: [
		"#f8fafc",
		"#f1f5f9",
		"#e2e8f0",
		"#cbd5e1",
		"#94a3b8",
		"#64748b",
		"#475569",
		"#334155",
		"#1e293b",
		"#0f172a"
	],
	gray: [
		"#f9fafb",
		"#f3f4f6",
		"#e5e7eb",
		"#d1d5db",
		"#9ca3af",
		"#6b7280",
		"#4b5563",
		"#374151",
		"#1f2937",
		"#111827"
	],
	red: [
		"#fef2f2",
		"#fee2e2",
		"#fecaca",
		"#fca5a5",
		"#f87171",
		"#ef4444",
		"#dc2626",
		"#b91c1c",
		"#991b1b",
		"#7f1d1d"
	],
	orange: [
		"#fff7ed",
		"#ffedd5",
		"#fed7aa",
		"#fdba74",
		"#fb923c",
		"#f97316",
		"#ea580c",
		"#c2410c",
		"#9a3412",
		"#7c2d12"
	],
	amber: [
		"#fffbeb",
		"#fef3c7",
		"#fde68a",
		"#fcd34d",
		"#fbbf24",
		"#f59e0b",
		"#d97706",
		"#b45309",
		"#92400e",
		"#78350f"
	],
	yellow: [
		"#fefce8",
		"#fef9c3",
		"#fef08a",
		"#fde047",
		"#facc15",
		"#eab308",
		"#ca8a04",
		"#a16207",
		"#854d0e",
		"#713f12"
	],
	lime: [
		"#f7fee7",
		"#ecfccb",
		"#d9f99d",
		"#bef264",
		"#a3e635",
		"#84cc16",
		"#65a30d",
		"#4d7c0f",
		"#3f6212",
		"#365314"
	],
	green: [
		"#f0fdf4",
		"#dcfce7",
		"#bbf7d0",
		"#86efac",
		"#4ade80",
		"#22c55e",
		"#16a34a",
		"#15803d",
		"#166534",
		"#14532d"
	],
	emerald: [
		"#ecfdf5",
		"#d1fae5",
		"#a7f3d0",
		"#6ee7b7",
		"#34d399",
		"#10b981",
		"#059669",
		"#047857",
		"#065f46",
		"#064e3b"
	],
	teal: [
		"#f0fdfa",
		"#ccfbf1",
		"#99f6e4",
		"#5eead4",
		"#2dd4bf",
		"#14b8a6",
		"#0d9488",
		"#0f766e",
		"#115e59",
		"#134e4a"
	],
	cyan: [
		"#ecfeff",
		"#cffafe",
		"#a5f3fc",
		"#67e8f9",
		"#22d3ee",
		"#06b6d4",
		"#0891b2",
		"#0e7490",
		"#155e75",
		"#164e63"
	],
	sky: [
		"#f0f9ff",
		"#e0f2fe",
		"#bae6fd",
		"#7dd3fc",
		"#38bdf8",
		"#0ea5e9",
		"#0284c7",
		"#0369a1",
		"#075985",
		"#0c4a6e"
	],
	blue: [
		"#eff6ff",
		"#dbeafe",
		"#bfdbfe",
		"#93c5fd",
		"#60a5fa",
		"#3b82f6",
		"#2563eb",
		"#1d4ed8",
		"#1e40af",
		"#1e3a8a"
	],
	indigo: [
		"#eef2ff",
		"#e0e7ff",
		"#c7d2fe",
		"#a5b4fc",
		"#818cf8",
		"#6366f1",
		"#4f46e5",
		"#4338ca",
		"#3730a3",
		"#312e81"
	],
	violet: [
		"#f5f3ff",
		"#ede9fe",
		"#ddd6fe",
		"#c4b5fd",
		"#a78bfa",
		"#8b5cf6",
		"#7c3aed",
		"#6d28d9",
		"#5b21b6",
		"#4c1d95"
	],
	purple: [
		"#faf5ff",
		"#f3e8ff",
		"#e9d5ff",
		"#d8b4fe",
		"#c084fc",
		"#a855f7",
		"#9333ea",
		"#7e22ce",
		"#6b21a8",
		"#581c87"
	],
	fuchsia: [
		"#fdf4ff",
		"#fae8ff",
		"#f5d0fe",
		"#f0abfc",
		"#e879f9",
		"#d946ef",
		"#c026d3",
		"#a21caf",
		"#86198f",
		"#701a75"
	],
	pink: [
		"#fdf2f8",
		"#fce7f3",
		"#fbcfe8",
		"#f9a8d4",
		"#f472b6",
		"#ec4899",
		"#db2777",
		"#be185d",
		"#9d174d",
		"#831843"
	],
	rose: [
		"#fff1f2",
		"#ffe4e6",
		"#fecdd3",
		"#fda4af",
		"#fb7185",
		"#f43f5e",
		"#e11d48",
		"#be123c",
		"#9f1239",
		"#881337"
	]
};
var TOKEN_HEX = {};
/** 'slate-100' or a design token name → is it a color class value? */
function isPaletteColor(value) {
	if (value in TOKEN_HEX) return true;
	const match = value.match(/^([a-z]+)-(\d{2,3})$/);
	return !!match && match[1] in TAILWIND_COLORS && TAILWIND_SHADES.includes(match[2]);
}
//#endregion
//#region src/lib/valueClass.ts
var ACCEPTED_UNITS = [
	"px",
	"rem",
	"em",
	"%",
	"ch",
	"ex",
	"fr"
];
var esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
new RegExp(`^\\d*\\.?\\d+(?:${ACCEPTED_UNITS.map(esc).join("|")})$`);
var TAIL_RE = /^(?:\[.+\]|\d+(?:\.\d+)?)$/;
/** build the class token for a prefix + tail (sign moves before the prefix) */
function buildTailClass(prefix, tail) {
	if (tail.startsWith("-")) return `-${prefix}-${tail.slice(1)}`;
	return `${prefix}-${tail}`;
}
/** parse a token into its tail for `prefix` (incl. leading '-'), or null */
function parseTail(token, prefix, opts = {}) {
	let neg = false;
	let rest;
	if (token.startsWith(`-${prefix}-`)) {
		neg = true;
		rest = token.slice(prefix.length + 2);
	} else if (token.startsWith(`${prefix}-`)) rest = token.slice(prefix.length + 1);
	else return null;
	if (!neg && opts.allowKeywords?.includes(rest)) return rest;
	if (!TAIL_RE.test(rest)) return null;
	return neg ? `-${rest}` : rest;
}
/** the size value text for a token, '' if none (`w-[300px]`→'300px', `w-full`→'full') */
function sizeClassToText(prefix, token) {
	if (!token || !token.startsWith(`${prefix}-`)) return "";
	const rest = token.slice(prefix.length + 1);
	return rest.startsWith("[") && rest.endsWith("]") ? rest.slice(1, -1) : rest;
}
var LEN_RE = /^\d*\.?\d+(?:px|rem|em|%)$/;
var TRACK_RE = /^-?\d*\.?\d+(?:em|rem|px)$/;
var WEIGHT_RE$1 = /^(?:[1-9]\d{0,2}|1000)$/;
/** whether free-form text is a valid arbitrary value for a named-scale format */
function matchesNamedFormat(format, text) {
	switch (format) {
		case "length": return LEN_RE.test(text);
		case "line-height": return /^\d*\.?\d+$/.test(text) || LEN_RE.test(text);
		case "tracking": return TRACK_RE.test(text);
		case "weight": return WEIGHT_RE$1.test(text);
	}
}
/** whether a token is a value for this named-scale prop (known class or in-format arbitrary) */
function isNamedValueClass(prefix, format, known, token) {
	if (known.includes(token)) return true;
	if (!token.startsWith(`${prefix}-`)) return false;
	return matchesNamedFormat(format, sizeClassToText(prefix, token));
}
/**
* Derive a numeric class prefix from an explicit-class slider's class list
* (e.g. `['grid-cols-1', …]` → `'grid-cols'`, signed `['-rotate-1', …]` →
* `'rotate'`). Returns null when the varying tail isn't numeric (named classes
* like `tracking-tight`), meaning custom input doesn't apply.
*/
function derivePrefix(classes) {
	if (!classes.length) return null;
	const parts = classes.map((c) => {
		const stripped = c.replace(/^-/, "");
		const i = stripped.lastIndexOf("-");
		return i === -1 ? null : [stripped.slice(0, i), stripped.slice(i + 1)];
	});
	if (parts.some((p) => p === null)) return null;
	const pre = parts[0][0];
	if (!parts.every((p) => p[0] === pre)) return null;
	if (!parts.every((p) => /^\d+(?:\.\d+)?$/.test(p[1]))) return null;
	return pre;
}
//#endregion
//#region src/lib/tieredBox.ts
/** Tailwind spacing steps (padding/margin) */
var SPACING = [
	"0",
	"1",
	"2",
	"3",
	"4",
	"6",
	"8",
	"10",
	"12",
	"16",
	"20",
	"24"
];
var borderWidthScheme = {
	steps: [
		"0",
		"1",
		"2",
		"4",
		"8"
	],
	slot: (base, s) => s === "all" ? base : `${base}-${s}`,
	className: (prefix, step) => step === "1" ? prefix : buildTailClass(prefix, step),
	parse: (token, prefix) => {
		if (token === prefix) return "1";
		return parseTail(token, prefix);
	}
};
//#endregion
//#region src/lib/styleCatalog.ts
var FLEX = ["flex", "inline-flex"];
var GRID = ["grid", "inline-grid"];
var FLEX_GRID = [...FLEX, ...GRID];
var inFlex = {
	when: "display",
	values: FLEX
};
var inGrid = {
	when: "display",
	values: GRID
};
var inFlexGrid = {
	when: "display",
	values: FLEX_GRID
};
var childOfFlex = {
	when: "parentDisplay",
	values: FLEX
};
var childOfGrid = {
	when: "parentDisplay",
	values: GRID
};
var childOfFlexGrid = {
	when: "parentDisplay",
	values: FLEX_GRID
};
var positioned = { when: "positioned" };
var whenTransition = { when: "transition" };
var whenMediaOrBg = { when: "mediaOrBackground" };
var OPACITY = [
	"0",
	"10",
	"20",
	"30",
	"40",
	"50",
	"60",
	"70",
	"80",
	"90",
	"100"
];
var sel = (pairs) => ({
	kind: "select",
	options: pairs.map(([label, cls]) => ({
		label,
		class: cls
	}))
});
var slide = (prefix, stops = SPACING) => ({
	kind: "slider",
	prefix,
	stops
});
var slideC = (pairs, custom) => ({
	kind: "slider",
	classes: pairs.map(([, cls]) => cls),
	labels: pairs.map(([label]) => label),
	...custom ? { custom } : {}
});
var signed = (prefix, mags) => {
	const neg = [...mags].reverse().map((m) => [`-${m}`, `-${prefix}-${m}`]);
	const pos = mags.map((m) => [m, `${prefix}-${m}`]);
	return slideC([
		...neg,
		["0", `${prefix}-0`],
		...pos
	]);
};
var col = (prefix) => ({
	kind: "color",
	prefix
});
var inp = (prefix, placeholder) => ({
	kind: "input",
	prefix,
	placeholder
});
var ico = (opts) => ({
	kind: "icons",
	options: opts.map(([label, cls, icon]) => ({
		label,
		class: cls,
		icon
	}))
});
var STYLE_SECTIONS = [
	{
		id: "layout",
		label: "Layout",
		properties: [
			{
				id: "display",
				label: "Display",
				control: ico([
					[
						"Block",
						"block",
						"Square"
					],
					[
						"Inline",
						"inline",
						"Baseline"
					],
					[
						"Flex",
						"flex",
						"StretchHorizontal"
					],
					[
						"Grid",
						"grid",
						"Grid3x3"
					],
					[
						"None",
						"hidden",
						"Ban"
					]
				])
			},
			{
				id: "direction",
				label: "Direction",
				needsDisplay: true,
				relevance: inFlex,
				control: ico([
					[
						"Row",
						"flex-row",
						"ArrowRight"
					],
					[
						"Column",
						"flex-col",
						"ArrowDown"
					],
					[
						"Row reverse",
						"flex-row-reverse",
						"ArrowLeft"
					],
					[
						"Col reverse",
						"flex-col-reverse",
						"ArrowUp"
					]
				])
			},
			{
				id: "align",
				label: "Align items",
				needsDisplay: true,
				relevance: inFlexGrid,
				control: ico([
					[
						"Start",
						"items-start",
						"AlignStartHorizontal"
					],
					[
						"Center",
						"items-center",
						"AlignCenterHorizontal"
					],
					[
						"End",
						"items-end",
						"AlignEndHorizontal"
					],
					[
						"Stretch",
						"items-stretch",
						"StretchVertical"
					],
					[
						"Baseline",
						"items-baseline",
						"Baseline"
					]
				])
			},
			{
				id: "justify",
				label: "Justify",
				needsDisplay: true,
				relevance: inFlexGrid,
				control: ico([
					[
						"Start",
						"justify-start",
						"AlignStartVertical"
					],
					[
						"Center",
						"justify-center",
						"AlignCenterVertical"
					],
					[
						"End",
						"justify-end",
						"AlignEndVertical"
					],
					[
						"Between",
						"justify-between",
						"AlignHorizontalSpaceBetween"
					],
					[
						"Around",
						"justify-around",
						"AlignHorizontalSpaceAround"
					],
					[
						"Evenly",
						"justify-evenly",
						"AlignHorizontalDistributeCenter"
					]
				])
			},
			{
				id: "align-content",
				label: "Align content",
				needsDisplay: true,
				relevance: inFlexGrid,
				control: ico([
					[
						"Start",
						"content-start",
						"AlignStartHorizontal"
					],
					[
						"Center",
						"content-center",
						"AlignCenterHorizontal"
					],
					[
						"End",
						"content-end",
						"AlignEndHorizontal"
					],
					[
						"Between",
						"content-between",
						"AlignVerticalSpaceBetween"
					],
					[
						"Around",
						"content-around",
						"AlignVerticalSpaceAround"
					],
					[
						"Evenly",
						"content-evenly",
						"AlignVerticalDistributeCenter"
					]
				])
			},
			{
				id: "gap",
				label: "Gap",
				needsDisplay: true,
				relevance: inFlexGrid,
				control: slide("gap")
			},
			{
				id: "flex",
				label: "Flex",
				relevance: childOfFlex,
				control: ico([
					[
						"1",
						"flex-1",
						"ChevronsLeftRight"
					],
					[
						"Auto",
						"flex-auto",
						"Expand"
					],
					[
						"Initial",
						"flex-initial",
						"Minimize2"
					],
					[
						"None",
						"flex-none",
						"Ban"
					]
				])
			},
			{
				id: "grow",
				label: "Grow",
				relevance: childOfFlex,
				control: ico([[
					"Grow",
					"grow",
					"Maximize2"
				], [
					"No grow",
					"grow-0",
					"Ban"
				]])
			},
			{
				id: "shrink",
				label: "Shrink",
				relevance: childOfFlex,
				control: ico([[
					"Shrink",
					"shrink",
					"Shrink"
				], [
					"No shrink",
					"shrink-0",
					"Ban"
				]])
			},
			{
				id: "order",
				label: "Order",
				relevance: childOfFlexGrid,
				control: inp("order", "1, first, last…"),
				default: "order-1"
			},
			{
				id: "grid-cols",
				label: "Grid cols",
				relevance: inGrid,
				control: slideC([
					["1", "grid-cols-1"],
					["2", "grid-cols-2"],
					["3", "grid-cols-3"],
					["4", "grid-cols-4"],
					["5", "grid-cols-5"],
					["6", "grid-cols-6"],
					["12", "grid-cols-12"]
				])
			},
			{
				id: "grid-rows",
				label: "Grid rows",
				relevance: inGrid,
				control: slide("grid-rows", [
					"1",
					"2",
					"3",
					"4",
					"5",
					"6"
				])
			},
			{
				id: "col-span",
				label: "Col span",
				relevance: childOfGrid,
				control: slideC([
					["1", "col-span-1"],
					["2", "col-span-2"],
					["3", "col-span-3"],
					["4", "col-span-4"],
					["5", "col-span-5"],
					["6", "col-span-6"],
					["Full", "col-span-full"]
				])
			},
			{
				id: "row-span",
				label: "Row span",
				relevance: childOfGrid,
				control: slideC([
					["1", "row-span-1"],
					["2", "row-span-2"],
					["3", "row-span-3"],
					["4", "row-span-4"],
					["5", "row-span-5"],
					["6", "row-span-6"],
					["Full", "row-span-full"]
				])
			},
			{
				id: "self",
				label: "Self align",
				relevance: childOfFlexGrid,
				control: ico([
					[
						"Auto",
						"self-auto",
						"Dot"
					],
					[
						"Start",
						"self-start",
						"AlignStartHorizontal"
					],
					[
						"Center",
						"self-center",
						"AlignCenterHorizontal"
					],
					[
						"End",
						"self-end",
						"AlignEndHorizontal"
					],
					[
						"Stretch",
						"self-stretch",
						"StretchVertical"
					]
				])
			},
			{
				id: "justify-self",
				label: "Justify self",
				relevance: childOfGrid,
				control: ico([
					[
						"Auto",
						"justify-self-auto",
						"Dot"
					],
					[
						"Start",
						"justify-self-start",
						"AlignStartVertical"
					],
					[
						"Center",
						"justify-self-center",
						"AlignCenterVertical"
					],
					[
						"End",
						"justify-self-end",
						"AlignEndVertical"
					],
					[
						"Stretch",
						"justify-self-stretch",
						"StretchHorizontal"
					]
				])
			}
		]
	},
	{
		id: "position",
		label: "Position",
		properties: [
			{
				id: "position",
				label: "Position",
				control: sel([
					["Static", "static"],
					["Relative", "relative"],
					["Absolute", "absolute"],
					["Fixed", "fixed"],
					["Sticky", "sticky"]
				])
			},
			{
				id: "top",
				label: "Top",
				control: slide("top"),
				relevance: positioned
			},
			{
				id: "right",
				label: "Right",
				control: slide("right"),
				relevance: positioned
			},
			{
				id: "bottom",
				label: "Bottom",
				control: slide("bottom"),
				relevance: positioned
			},
			{
				id: "left",
				label: "Left",
				control: slide("left"),
				relevance: positioned
			},
			{
				id: "z-index",
				label: "Z-index",
				control: slide("z", [
					"0",
					"10",
					"20",
					"30",
					"40",
					"50"
				]),
				relevance: positioned
			}
		]
	},
	{
		id: "size",
		label: "Size",
		properties: [
			{
				id: "width",
				label: "Width",
				control: inp("w", "full, 64, 1/2…")
			},
			{
				id: "height",
				label: "Height",
				control: inp("h", "full, 64, screen…")
			},
			{
				id: "min-width",
				label: "Min width",
				control: inp("min-w", "0, full…")
			},
			{
				id: "max-width",
				label: "Max width",
				control: inp("max-w", "sm, md, xl…")
			},
			{
				id: "min-height",
				label: "Min height",
				control: inp("min-h", "0, screen…")
			},
			{
				id: "max-height",
				label: "Max height",
				control: inp("max-h", "full, screen…")
			},
			{
				id: "overflow",
				label: "Overflow",
				control: ico([
					[
						"Visible",
						"overflow-visible",
						"Eye"
					],
					[
						"Hidden",
						"overflow-hidden",
						"EyeOff"
					],
					[
						"Scroll",
						"overflow-scroll",
						"Scroll"
					],
					[
						"Auto",
						"overflow-auto",
						"MoveVertical"
					]
				])
			}
		]
	},
	{
		id: "spacing",
		label: "Spacing",
		properties: [{
			id: "padding",
			label: "Padding",
			control: slide("p")
		}, {
			id: "margin",
			label: "Margin",
			control: slide("m")
		}]
	},
	{
		id: "text",
		label: "Text",
		properties: [
			{
				id: "text-color",
				label: "Color",
				control: col("text")
			},
			{
				id: "font-family",
				label: "Font",
				control: sel([
					["Sans", "font-sans"],
					["Serif", "font-serif"],
					["Mono", "font-mono"]
				])
			},
			{
				id: "font-size",
				label: "Size",
				control: slideC([
					["XS", "text-xs"],
					["SM", "text-sm"],
					["Base", "text-base"],
					["LG", "text-lg"],
					["XL", "text-xl"],
					["2XL", "text-2xl"],
					["3XL", "text-3xl"],
					["4XL", "text-4xl"],
					["5XL", "text-5xl"],
					["6XL", "text-6xl"],
					["7XL", "text-7xl"],
					["8XL", "text-8xl"],
					["9XL", "text-9xl"]
				], {
					prefix: "text",
					format: "length"
				})
			},
			{
				id: "font-weight",
				label: "Weight",
				control: slideC([
					["Thin", "font-thin"],
					["Extralight", "font-extralight"],
					["Light", "font-light"],
					["Normal", "font-normal"],
					["Medium", "font-medium"],
					["Semibold", "font-semibold"],
					["Bold", "font-bold"],
					["Extrabold", "font-extrabold"],
					["Black", "font-black"]
				], {
					prefix: "font",
					format: "weight"
				})
			},
			{
				id: "text-align",
				label: "Align",
				control: ico([
					[
						"Left",
						"text-left",
						"AlignLeft"
					],
					[
						"Center",
						"text-center",
						"AlignCenter"
					],
					[
						"Right",
						"text-right",
						"AlignRight"
					],
					[
						"Justify",
						"text-justify",
						"AlignJustify"
					]
				])
			},
			{
				id: "line-height",
				label: "Line height",
				control: slideC([
					["None", "leading-none"],
					["Tight", "leading-tight"],
					["Snug", "leading-snug"],
					["Normal", "leading-normal"],
					["Relaxed", "leading-relaxed"],
					["Loose", "leading-loose"]
				], {
					prefix: "leading",
					format: "line-height"
				})
			},
			{
				id: "letter-spacing",
				label: "Letter spacing",
				control: slideC([
					["Tighter", "tracking-tighter"],
					["Tight", "tracking-tight"],
					["Normal", "tracking-normal"],
					["Wide", "tracking-wide"],
					["Wider", "tracking-wider"],
					["Widest", "tracking-widest"]
				], {
					prefix: "tracking",
					format: "tracking"
				})
			},
			{
				id: "text-transform",
				label: "Transform",
				control: ico([
					[
						"Uppercase",
						"uppercase",
						"CaseUpper"
					],
					[
						"Lowercase",
						"lowercase",
						"CaseLower"
					],
					[
						"Capitalize",
						"capitalize",
						"CaseSensitive"
					],
					[
						"Normal",
						"normal-case",
						"Ban"
					]
				])
			},
			{
				id: "text-decoration",
				label: "Decoration",
				control: ico([
					[
						"Underline",
						"underline",
						"Underline"
					],
					[
						"Overline",
						"overline",
						"Minus"
					],
					[
						"Line through",
						"line-through",
						"Strikethrough"
					],
					[
						"None",
						"no-underline",
						"Ban"
					]
				])
			},
			{
				id: "word-break",
				label: "Word break",
				control: ico([
					[
						"Normal",
						"break-normal",
						"AlignJustify"
					],
					[
						"Words",
						"break-words",
						"WrapText"
					],
					[
						"All",
						"break-all",
						"ChevronsLeftRight"
					],
					[
						"Keep",
						"break-keep",
						"Ban"
					]
				])
			},
			{
				id: "list-style",
				label: "List",
				control: ico([
					[
						"None",
						"list-none",
						"Ban"
					],
					[
						"Disc",
						"list-disc",
						"List"
					],
					[
						"Decimal",
						"list-decimal",
						"ListOrdered"
					]
				])
			}
		]
	},
	{
		id: "background",
		label: "Background",
		properties: [
			{
				id: "bg-color",
				label: "Color",
				control: col("bg")
			},
			{
				id: "object-fit",
				label: "Object fit",
				relevance: whenMediaOrBg,
				control: sel([
					["Contain", "object-contain"],
					["Cover", "object-cover"],
					["Fill", "object-fill"],
					["None", "object-none"],
					["Scale down", "object-scale-down"]
				])
			},
			{
				id: "object-position",
				label: "Object position",
				relevance: whenMediaOrBg,
				control: sel([
					["Center", "object-center"],
					["Top", "object-top"],
					["Bottom", "object-bottom"],
					["Left", "object-left"],
					["Right", "object-right"]
				])
			},
			{
				id: "bg-size",
				label: "BG size",
				relevance: whenMediaOrBg,
				control: sel([
					["Auto", "bg-auto"],
					["Cover", "bg-cover"],
					["Contain", "bg-contain"]
				])
			},
			{
				id: "bg-repeat",
				label: "BG repeat",
				relevance: whenMediaOrBg,
				control: sel([
					["Repeat", "bg-repeat"],
					["No repeat", "bg-no-repeat"],
					["Repeat X", "bg-repeat-x"],
					["Repeat Y", "bg-repeat-y"]
				])
			}
		]
	},
	{
		id: "border",
		label: "Border",
		properties: [
			{
				id: "border-color",
				label: "Color",
				control: col("border")
			},
			{
				id: "radius",
				label: "Radius",
				control: slideC([
					["None", "rounded-none"],
					["XS", "rounded-xs"],
					["SM", "rounded-sm"],
					["MD", "rounded-md"],
					["LG", "rounded-lg"],
					["XL", "rounded-xl"],
					["2XL", "rounded-2xl"],
					["3XL", "rounded-3xl"],
					["Full", "rounded-full"]
				], {
					prefix: "rounded",
					format: "length"
				})
			},
			{
				id: "border-style",
				label: "Style",
				control: sel([
					["Solid", "border-solid"],
					["Dashed", "border-dashed"],
					["Dotted", "border-dotted"],
					["Double", "border-double"],
					["None", "border-none"]
				])
			}
		]
	},
	{
		id: "effects",
		label: "Effects",
		properties: [
			{
				id: "opacity",
				label: "Opacity",
				control: slide("opacity", OPACITY),
				default: "opacity-100"
			},
			{
				id: "shadow",
				label: "Shadow",
				control: slideC([
					["None", "shadow-none"],
					["XS", "shadow-xs"],
					["SM", "shadow-sm"],
					["MD", "shadow-md"],
					["LG", "shadow-lg"],
					["XL", "shadow-xl"],
					["2XL", "shadow-2xl"]
				])
			},
			{
				id: "blur",
				label: "Blur",
				control: slideC([
					["None", "blur-none"],
					["XS", "blur-xs"],
					["SM", "blur-sm"],
					["MD", "blur-md"],
					["LG", "blur-lg"],
					["XL", "blur-xl"],
					["2XL", "blur-2xl"],
					["3XL", "blur-3xl"]
				])
			}
		]
	},
	{
		id: "transitions",
		label: "Transitions",
		properties: [
			{
				id: "transition",
				label: "Transition",
				control: sel([
					["None", "transition-none"],
					["All", "transition-all"],
					["Default", "transition"],
					["Colors", "transition-colors"],
					["Opacity", "transition-opacity"],
					["Transform", "transition-transform"],
					["Shadow", "transition-shadow"]
				])
			},
			{
				id: "duration",
				label: "Duration",
				relevance: whenTransition,
				control: slide("duration", [
					"75",
					"100",
					"150",
					"200",
					"300",
					"500",
					"700",
					"1000"
				])
			},
			{
				id: "timing",
				label: "Easing",
				relevance: whenTransition,
				control: ico([
					[
						"Linear",
						"ease-linear",
						"Minus"
					],
					[
						"In",
						"ease-in",
						"Turtle"
					],
					[
						"Out",
						"ease-out",
						"Rabbit"
					],
					[
						"In out",
						"ease-in-out",
						"Spline"
					]
				])
			},
			{
				id: "delay",
				label: "Delay",
				relevance: whenTransition,
				control: slide("delay", [
					"75",
					"150",
					"300",
					"500",
					"700",
					"1000"
				])
			}
		]
	},
	{
		id: "transform",
		label: "Transform",
		properties: [
			{
				id: "scale",
				label: "Scale",
				control: slide("scale", [
					"0",
					"50",
					"75",
					"90",
					"95",
					"100",
					"105",
					"110",
					"125",
					"150"
				])
			},
			{
				id: "transform-origin",
				label: "Origin",
				control: {
					kind: "select",
					options: [
						{
							label: "Center",
							class: "origin-center"
						},
						{
							label: "Top",
							class: "origin-top"
						},
						{
							label: "Top right",
							class: "origin-top-right"
						},
						{
							label: "Right",
							class: "origin-right"
						},
						{
							label: "Bottom right",
							class: "origin-bottom-right"
						},
						{
							label: "Bottom",
							class: "origin-bottom"
						},
						{
							label: "Bottom left",
							class: "origin-bottom-left"
						},
						{
							label: "Left",
							class: "origin-left"
						},
						{
							label: "Top left",
							class: "origin-top-left"
						}
					]
				}
			},
			{
				id: "rotate",
				label: "Rotate",
				control: signed("rotate", [
					"1",
					"2",
					"3",
					"6",
					"12",
					"45",
					"90",
					"180"
				])
			},
			{
				id: "translate-x",
				label: "Translate X",
				control: signed("translate-x", [
					"1",
					"2",
					"3",
					"4",
					"6",
					"8"
				])
			},
			{
				id: "translate-y",
				label: "Translate Y",
				control: signed("translate-y", [
					"1",
					"2",
					"3",
					"4",
					"6",
					"8"
				])
			}
		]
	},
	{
		id: "interactivity",
		label: "Interactivity",
		properties: [
			{
				id: "cursor",
				label: "Cursor",
				control: sel([
					["Auto", "cursor-auto"],
					["Default", "cursor-default"],
					["Pointer", "cursor-pointer"],
					["Wait", "cursor-wait"],
					["Text", "cursor-text"],
					["Move", "cursor-move"],
					["Not allowed", "cursor-not-allowed"]
				])
			},
			{
				id: "user-select",
				label: "User select",
				control: sel([
					["None", "select-none"],
					["Text", "select-text"],
					["All", "select-all"],
					["Auto", "select-auto"]
				])
			},
			{
				id: "pointer-events",
				label: "Pointer events",
				control: ico([[
					"None",
					"pointer-events-none",
					"Ban"
				], [
					"Auto",
					"pointer-events-auto",
					"MousePointer2"
				]])
			}
		]
	}
];
//#endregion
//#region src/lib/styles.ts
/** the ordered tailwind classes a slider steps through */
function sliderClasses(c) {
	return c.classes ?? c.stops.map((s) => `${c.prefix}-${s}`);
}
/** the class prefix a slider's custom-value input writes to, or null if none */
function sliderPrefix(c) {
	return c.custom?.prefix ?? c.prefix ?? (c.classes ? derivePrefix(c.classes) : null);
}
/** state/breakpoint prefixes the class input understands (typed as `hover:`) */
var VARIANTS = [
	"hover",
	"focus",
	"focus-visible",
	"focus-within",
	"active",
	"visited",
	"disabled",
	"checked",
	"required",
	"invalid",
	"group-hover",
	"group-focus",
	"peer-hover",
	"peer-focus",
	"peer-checked",
	"first",
	"last",
	"only",
	"odd",
	"even",
	"empty",
	"first-of-type",
	"last-of-type",
	"before",
	"after",
	"marker",
	"selection",
	"placeholder",
	"first-line",
	"first-letter",
	"file",
	"backdrop",
	"sm",
	"md",
	"lg",
	"xl",
	"2xl",
	"dark",
	"print",
	"motion-safe",
	"motion-reduce",
	"rtl",
	"ltr",
	"current",
	"group-current"
];
function buildVocabulary() {
	const out = /* @__PURE__ */ new Set();
	for (const section of STYLE_SECTIONS) for (const prop of section.properties) {
		const control = prop.control;
		if (control.kind === "select") control.options.forEach((o) => out.add(o.class));
		if (control.kind === "icons") control.options.forEach((o) => out.add(o.class));
		if (control.kind === "slider") sliderClasses(control).forEach((c) => out.add(c));
	}
	const spacing = [
		"p",
		"px",
		"py",
		"pt",
		"pb",
		"pl",
		"pr",
		"m",
		"mx",
		"my",
		"mt",
		"mb",
		"ml",
		"mr",
		"gap",
		"gap-x",
		"gap-y"
	];
	const SPACING_VALID = [
		...SPACING,
		"5",
		"14",
		"28",
		"32"
	];
	for (const prefix of spacing) for (const stop of SPACING_VALID) out.add(`${prefix}-${stop}`);
	const SIZE_STOPS = [
		"0",
		"1",
		"2",
		"3",
		"4",
		"5",
		"6",
		"8",
		"10",
		"12",
		"14",
		"16",
		"20",
		"24",
		"28",
		"32",
		"36",
		"40",
		"44",
		"48",
		"52",
		"56",
		"60",
		"64",
		"72",
		"80",
		"96"
	];
	for (const prefix of [
		"w",
		"h",
		"size"
	]) for (const stop of SIZE_STOPS) out.add(`${prefix}-${stop}`);
	for (const prefix of ["translate-x", "translate-y"]) {
		for (const stop of SIZE_STOPS) {
			out.add(`${prefix}-${stop}`);
			if (stop !== "0") out.add(`-${prefix}-${stop}`);
		}
		for (const frac of ["full", "1/2"]) {
			out.add(`${prefix}-${frac}`);
			out.add(`-${prefix}-${frac}`);
		}
	}
	for (const prefix of [
		"top",
		"right",
		"bottom",
		"left",
		"inset",
		"inset-x",
		"inset-y",
		"m",
		"mx",
		"my",
		"mt",
		"mb",
		"ml",
		"mr"
	]) for (const stop of SPACING) if (stop !== "0") out.add(`-${prefix}-${stop}`);
	for (const prefix of [
		"m",
		"mx",
		"my",
		"mt",
		"mb",
		"ml",
		"mr"
	]) out.add(`${prefix}-auto`);
	for (const prefix of [
		"inset",
		"inset-x",
		"inset-y",
		"top",
		"right",
		"bottom",
		"left"
	]) out.add(`${prefix}-auto`);
	for (const s of [
		"all",
		"x",
		"y",
		"t",
		"r",
		"b",
		"l"
	]) {
		const prefix = borderWidthScheme.slot("border", s);
		for (const step of borderWidthScheme.steps) out.add(borderWidthScheme.className(prefix, step));
	}
	for (const prefix of [
		"bg",
		"text",
		"border",
		"outline",
		"ring",
		"accent",
		"decoration",
		"divide"
	]) for (const color of Object.keys(TAILWIND_COLORS)) for (const shade of TAILWIND_SHADES) out.add(`${prefix}-${color}-${shade}`);
	for (const axis of ["x", "y"]) {
		out.add(`divide-${axis}`);
		out.add(`divide-${axis}-reverse`);
		for (const w of [
			"0",
			"2",
			"4",
			"8"
		]) out.add(`divide-${axis}-${w}`);
	}
	for (const kw of [
		"solid",
		"dashed",
		"dotted",
		"double",
		"none",
		"white",
		"black",
		"transparent",
		"current"
	]) out.add(`divide-${kw}`);
	for (const w of [
		"0",
		"1",
		"2",
		"4",
		"8"
	]) {
		out.add(`outline-${w}`);
		out.add(`outline-offset-${w}`);
		out.add(`ring-${w}`);
		out.add(`ring-offset-${w}`);
	}
	[
		"outline",
		"outline-hidden",
		"outline-dashed",
		"outline-dotted",
		"outline-double",
		"outline-solid",
		"ring",
		"ring-inset",
		"outline-white",
		"outline-black",
		"outline-transparent",
		"outline-current",
		"ring-white",
		"ring-black",
		"ring-transparent",
		"ring-current",
		"accent-auto",
		"accent-white",
		"accent-black",
		"accent-current",
		"sr-only",
		"not-sr-only"
	].forEach((c) => out.add(c));
	[
		"bg-white",
		"bg-black",
		"bg-transparent",
		"text-white",
		"text-black",
		"border-white",
		"border-black",
		"border-transparent",
		"border-current",
		"text-transparent",
		"text-current",
		"bg-current",
		"relative",
		"absolute",
		"fixed",
		"sticky",
		"flex-wrap",
		"flex-1",
		"shrink-0",
		"grow",
		"w-full",
		"w-auto",
		"w-screen",
		"w-fit",
		"h-full",
		"h-auto",
		"h-screen",
		"h-fit",
		"min-h-screen",
		"max-w-sm",
		"max-w-md",
		"max-w-lg",
		"max-w-xl",
		"max-w-2xl",
		"max-w-4xl",
		"max-w-6xl",
		"mx-auto",
		"italic",
		"underline",
		"uppercase",
		"lowercase",
		"capitalize",
		"truncate",
		"leading-tight",
		"leading-normal",
		"leading-relaxed",
		"tracking-tight",
		"tracking-wide",
		"rounded",
		"shadow",
		"shadow-sm",
		"shadow-md",
		"shadow-lg",
		"shadow-xl",
		"opacity-0",
		"opacity-50",
		"opacity-75",
		"opacity-100",
		"overflow-hidden",
		"overflow-auto",
		"overflow-x-auto",
		"overflow-y-auto",
		"overflow-x-hidden",
		"overflow-y-hidden",
		"overflow-x-scroll",
		"overflow-y-scroll",
		"overflow-clip",
		"overflow-x-clip",
		"overflow-y-clip",
		"transition-all",
		"transition-colors",
		"duration-150",
		"duration-300",
		"duration-500",
		"ease-in",
		"ease-out",
		"ease-in-out",
		"cursor-pointer",
		"select-none",
		"pointer-events-none",
		"z-0",
		"z-10",
		"z-20",
		"z-50",
		"grid-cols-1",
		"grid-cols-2",
		"grid-cols-3",
		"grid-cols-4",
		"grid-cols-6",
		"grid-cols-12",
		"object-cover",
		"object-contain",
		"aspect-square",
		"aspect-video",
		"antialiased",
		"col-span-full",
		"col-auto",
		"row-span-full",
		"inline",
		"inline-block",
		"inline-flex",
		"inline-grid",
		"outline-none",
		"whitespace-normal",
		"whitespace-nowrap",
		"whitespace-pre",
		"whitespace-pre-line",
		"whitespace-pre-wrap",
		"break-words",
		"break-all",
		"group",
		"peer",
		"h-px",
		"w-px",
		"inset-0",
		"inset-x-0",
		"inset-y-0",
		"appearance-none",
		"appearance-auto",
		"resize",
		"resize-none",
		"resize-x",
		"resize-y",
		"animate-none",
		"animate-spin",
		"animate-pulse",
		"animate-bounce",
		"animate-ping",
		"table-auto",
		"table-fixed",
		"border-collapse",
		"border-separate",
		"caption-top",
		"caption-bottom",
		"align-top",
		"align-middle",
		"align-bottom",
		"align-baseline",
		"align-text-top",
		"align-text-bottom",
		"align-sub",
		"align-super",
		"prose",
		"visible",
		"invisible",
		"collapse",
		"grayscale",
		"grayscale-0",
		"blur-sm",
		"blur-md",
		"blur-none",
		"backdrop-blur-none",
		"backdrop-blur-sm",
		"backdrop-blur",
		"backdrop-blur-md",
		"backdrop-blur-lg",
		"backdrop-blur-xl",
		"underline-offset-1",
		"underline-offset-2",
		"underline-offset-4",
		"underline-offset-8"
	].forEach((c) => out.add(c));
	for (let n = 1; n <= 12; n++) {
		out.add(`col-span-${n}`);
		out.add(`col-start-${n}`);
		out.add(`col-end-${n}`);
	}
	for (let n = 1; n <= 6; n++) {
		out.add(`row-span-${n}`);
		out.add(`row-start-${n}`);
		out.add(`row-end-${n}`);
	}
	return [...out];
}
var VOCABULARY = buildVocabulary();
var TOKEN_CLASSES = [];
function setStyleTokens(names) {
	TOKEN_CLASSES = names.flatMap((n) => [
		`bg-${n}`,
		`text-${n}`,
		`border-${n}`,
		`outline-${n}`,
		`ring-${n}`,
		`accent-${n}`,
		`decoration-${n}`,
		`divide-${n}`
	]);
}
/**
* Suggests classes for the query, honouring variant prefixes:
* "hover:bg-r" suggests "hover:bg-red-500". While a variant itself is
* being typed ("hov"), the prefix completion ("hover:") is offered.
*/
function suggestClasses(query, limit = 8) {
	const split = splitClassVariants(query.trim());
	const prefix = split.variants.length ? `${split.variants.join(":")}:` : "";
	const base = split.base.toLowerCase();
	if (!base && !prefix) return [];
	const results = [];
	if (!prefix && base) {
		for (const variant of VARIANTS) if (variant.startsWith(base)) results.push(`${variant}:`);
	}
	const pool = [...TOKEN_CLASSES, ...VOCABULARY];
	const starts = pool.filter((c) => c.startsWith(base)).sort((a, b) => a === base ? -1 : b === base ? 1 : a.length - b.length);
	const contains = base.length > 1 ? pool.filter((c) => !c.startsWith(base) && c.includes(base)) : [];
	for (const cls of [...starts, ...contains]) {
		if (results.length >= limit) break;
		results.push(prefix + cls);
	}
	return results.slice(0, limit);
}
/**
* Finds the class token in a class list that this property controls,
* so the visual editor can read its state straight from the classes
* string (the single source of truth).
*/
function matchClass(prop, classes) {
	const control = prop.control;
	switch (control.kind) {
		case "select":
		case "icons": return classes.find((cls) => control.options.some((o) => o.class === cls));
		case "color": return classes.find((cls) => {
			if (!cls.startsWith(`${control.prefix}-`)) return false;
			const value = cls.slice(control.prefix.length + 1);
			return value.startsWith("[#") || isPaletteColor(value) || [
				"white",
				"black",
				"transparent"
			].includes(value);
		});
		case "slider": {
			const known = sliderClasses(control);
			const exact = classes.find((cls) => known.includes(cls));
			if (exact) return exact;
			if (control.custom) {
				const { prefix, format } = control.custom;
				return classes.find((cls) => isNamedValueClass(prefix, format, known, cls));
			}
			const prefix = sliderPrefix(control);
			if (prefix) return classes.find((cls) => parseTail(cls, prefix) !== null);
			return;
		}
		case "input": return classes.find((cls) => cls.startsWith(`${control.prefix}-`));
	}
}
var VOCAB_SET = new Set(VOCABULARY);
var VARIANT_SET = new Set(VARIANTS);
var STATE_VARIANTS = /* @__PURE__ */ new Set([
	"hover",
	"focus",
	"focus-visible",
	"active",
	"disabled",
	"group-hover",
	"first",
	"last"
]);
/** true when a class carries a state variant, e.g. `hover:…`, `focus:…` */
function isStateClass(cls) {
	return splitClassVariants(cls).variants.some((v) => STATE_VARIANTS.has(v));
}
/** splits `hover:md:bg-red-500` into its variant prefix and base class.
* Bracket-aware, so `[&_a]:underline` and `bg-[url(https://x)]` both split where
* they actually should. */
function splitVariant(cls) {
	const { variants, base } = splitClassVariants(cls);
	return {
		variant: variants.length ? `${variants.join(":")}:` : "",
		base
	};
}
/** true when a variant segment is known — a fixed variant, or an arbitrary
*  min/max-width breakpoint variant like `max-[767px]` / `min-[48rem]` */
/** an arbitrary variant: `[&_a]`, `[&>*]`, `[&_li]:` — a raw selector with `&`.
* Length-capped and brace-free because it lands in a stylesheet. */
var ARBITRARY_VARIANT_RE = /^\[&[^{};]{0,80}\]$/;
/** the bracketed-parameter variants: data-[...], aria-[...], has-[...], … */
var PARAM_VARIANT_RE = /^(?:data|aria|has|not|group-has|peer-has|supports|nth|nth-last)-\[[^{};]{1,80}\]$/;
/** `group-*` / `peer-*` with a named state (`group-focus-visible`, `peer-invalid`) */
var GROUP_PEER_RE = /^(?:group|peer)-[a-z][a-z-]*$/;
function isKnownVariant(v) {
	return VARIANT_SET.has(v) || /^(?:min|max)-\[[0-9.]+(?:px|rem|em)\]$/.test(v) || ARBITRARY_VARIANT_RE.test(v) || PARAM_VARIANT_RE.test(v) || GROUP_PEER_RE.test(v);
}
/**
* Split a class into its variant segments and base, respecting brackets.
*
* A plain `split(':')` breaks every class whose brackets contain a colon —
* `[&_a:hover]:underline`, `bg-[url(https://…)]` — which is most of what
* descendant styling is for. Depth tracking is the difference between those
* being expressible and being rejected as malformed.
*/
function splitClassVariants(cls) {
	const variants = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < cls.length; i++) {
		const ch = cls[i];
		if (ch === "[" || ch === "(") depth++;
		else if (ch === "]" || ch === ")") depth--;
		else if (ch === ":" && depth === 0) {
			variants.push(cls.slice(start, i));
			start = i + 1;
		}
	}
	return {
		variants,
		base: cls.slice(start)
	};
}
/** numeric flex shorthand Tailwind v4 accepts on its scale: `flex-2`, `flex-0.5` */
var FLEX_NUMERIC_RE = /^flex-\d+(?:\.\d+)?$/;
/** every display utility — one conflict group, whether or not the visual
* catalog lists it (it omits the inline-* forms), so `inline-flex` replaces
* `flex` instead of coexisting with it and losing to stylesheet order */
var DISPLAY_CLASSES = /* @__PURE__ */ new Set([
	"block",
	"inline-block",
	"inline",
	"flex",
	"inline-flex",
	"grid",
	"inline-grid",
	"hidden",
	"contents",
	"flow-root"
]);
/** does the class list already set a display, at any variant? Wider than
* matching the Style panel's Display property, whose catalog omits the
* inline-* forms: `inline-flex` IS a display, and treating it as absent makes
* callers add a second one beside it. */
function hasDisplayClass(tokens) {
	return tokens.some((t) => DISPLAY_CLASSES.has(splitVariant(t).base));
}
/** bg-* utilities that are NOT background-color (size/position/repeat/…) —
* everything else groups as one color property so `bg-paper` replaces
* `bg-[#f5f3edee]` and vice versa (arbitrary values are outside the catalog,
* so without this they never conflicted with anything) */
var NON_COLOR_BG_RE = /^bg-(?:auto$|cover$|contain$|center$|top|bottom|left|right|repeat|no-repeat|fixed$|local$|scroll$|clip-|origin-|gradient-|linear-|radial-|conic-|none$|blend-|size-|position-)/;
/** font-family utilities — the keyword forms AND an arbitrary family
* (`font-[Instrument_Serif]`, letters in the value). One conflict group so
* `font-mono` and `font-[JetBrains_Mono]` replace each other instead of
* coexisting (both set font-family; the last emitted would otherwise win at
* random, leaving the arbitrary face silently inert) */
var FONT_FAMILY_RE$1 = /^font-(?:sans|serif|mono)$/;
var FONT_ARBITRARY_FAMILY_RE = /^font-\[[^\]]*[A-Za-z][^\]]*\]$/;
/** Tailwind v4 spacing/size utilities take ANY numeric step (the scale is
* `calc(var(--spacing) * n)`, so `h-11`, `h-13`, `p-7` are all valid) plus a
* few keywords — the old enumerated scale rejected the in-between steps
* (`h-11` failed while `h-10`/`h-12` passed). Signed for the offset/margin/
* translate families. */
var SPACING_PREFIX = "(?:p[xytblr]?|m[xytblr]?|gap(?:-[xy])?|space-[xy]|w|h|size|min-w|min-h|max-w|max-h|basis|top|right|bottom|left|inset(?:-[xy])?|translate-[xy]|scroll-m[xytblr]?|scroll-p[xytblr]?)";
var SPACING_NUMERIC_RE = new RegExp(`^-?${SPACING_PREFIX}-\\d+(?:\\.\\d+)?$`);
/** fraction sizing — `basis-1/2`, `w-2/3`, `max-w-1/2`, `-translate-x-1/3`.
* Tailwind resolves any n/d on these families, and they are everyday classes;
* the numeric-only rule above rejected them, which read as "not a real class"
* when it only meant "not enumerated". */
var SPACING_FRACTION_RE = new RegExp(`^-?${SPACING_PREFIX}-\\d+\\/\\d+$`);
var SIZE_KEYWORD_RE = new RegExp(`^(?:w|h|size|min-w|min-h|max-w|max-h|basis)-(?:${[
	"full",
	"auto",
	"min",
	"max",
	"fit",
	"none",
	"screen",
	"prose",
	"px"
].join("|")})$`);
/** the t-shirt sizing scale on the same families. `max-w-4xl` used to pass only
* because it happened to be hand-listed in `common` while `max-w-3xl` and
* `max-w-7xl` were not — an enumeration gap that read as "not a real class".
* Folds into the `size:<family>` conflict group via sizeFamily(). */
var SIZE_TSHIRT_RE = /^(?:w|h|size|min-w|min-h|max-w|max-h|basis)-(?:3xs|2xs|xs|sm|md|lg|xl|[2-7]xl)$/;
/** Tailwind v4 resolves these families from any number, so the enumerated
* sliders in the catalog (scale 0–150 in steps, z 0/10/20/50) were rejecting
* perfectly ordinary values like `scale-140` and `z-2`. */
var DYNAMIC_NUMERIC_RE = /^-?(?:scale|scale-x|scale-y|rotate|skew-x|skew-y|z|opacity|order|grow|shrink|columns|leading)-\d+(?:\.\d+)?$/;
/** the whole border-radius family incl. v4's `rounded-4xl` and the per-corner /
* logical-side forms, none of which the icon-group catalog lists */
var ROUNDED_RE = /^rounded(?:-(t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee))?(?:-(?:none|xs|sm|md|lg|xl|[2-4]xl|full))?$/;
/** background-position keywords — the natural companion of `background` media
* (`bg-center`, `bg-top`, v4's `bg-top-left` plus the legacy `bg-left-top`
* order). The catalog covers bg-size and bg-repeat but never listed these, so
* `bg-center` read as "not a real class" while `bg-cover` passed. One conflict
* group: a background has one position. */
var BG_POSITION_RE = /^bg-(?:center|top|bottom|left|right|top-left|top-right|bottom-left|bottom-right|left-top|left-bottom|right-top|right-bottom)$/;
/** transform-origin keywords (`origin-top-left` …). Authored as whole tokens, so
* the generic "use the arbitrary form" hint used to suggest the INVALID
* `origin-top-[…]` by splitting at the last dash. */
var ORIGIN_RE = /^origin-(?:center|top|top-right|right|bottom-right|bottom|bottom-left|left|top-left)$/;
/** visibility — a property of its own, NOT part of the display group: `invisible`
* must not evict `flex` (it hides the box without changing its layout role) */
var VISIBILITY_CLASSES = /* @__PURE__ */ new Set([
	"visible",
	"invisible",
	"collapse"
]);
/**
* A class is valid if every variant segment is known and the base is either
* an arbitrary-value class (`p-[13px]`), a numeric flex (`flex-2`), in our
* vocabulary, or a design token.
*/
function isValidClass(cls) {
	const { variants: segments, base } = splitClassVariants(cls);
	if (!base) return false;
	if (segments.some((v) => !isKnownVariant(v))) return false;
	if (/-\[.+\]$/.test(base)) return true;
	if (FLEX_NUMERIC_RE.test(base)) return true;
	if (SPACING_NUMERIC_RE.test(base)) return true;
	if (SPACING_FRACTION_RE.test(base)) return true;
	if (SIZE_KEYWORD_RE.test(base)) return true;
	if (SIZE_TSHIRT_RE.test(base)) return true;
	if (DYNAMIC_NUMERIC_RE.test(base)) return true;
	if (ROUNDED_RE.test(base)) return true;
	if (BG_POSITION_RE.test(base)) return true;
	if (ORIGIN_RE.test(base)) return true;
	if (VISIBILITY_CLASSES.has(base)) return true;
	return VOCAB_SET.has(base) || TOKEN_CLASSES.includes(base);
}
/** the sizing family a class belongs to (`max-w-full` → "max-w", `w-1/2` → "w"),
* longest prefix first so `max-w-*` never reads as `w-*`. One conflict group per
* family, so the fraction/keyword forms replace the enumerated ones instead of
* coexisting — without this `w-1/2` would simply stack onto `w-full`. */
var SIZE_FAMILIES = [
	"min-w",
	"min-h",
	"max-w",
	"max-h",
	"basis",
	"size",
	"w",
	"h"
];
function sizeFamily(base) {
	for (const family of SIZE_FAMILIES) if (base.startsWith(`${family}-`) && base.length > family.length + 1) return `size:${family}`;
}
/** the catalog property a bare class belongs to, if any */
function propForBase(base) {
	for (const section of STYLE_SECTIONS) for (const prop of section.properties) if (matchClass(prop, [base]) === base) return prop;
}
/**
* A stable identity for the CSS property a bare class controls, used to detect
* conflicts. Prefers the catalog property; falls back to pattern-based groups
* (e.g. every `flex-*` shorthand shares one identity) so a typed `flex-2`
* replaces the icon-picked `flex-1`.
*/
function propKey(base) {
	if (FLEX_NUMERIC_RE.test(base) || [
		"flex-auto",
		"flex-initial",
		"flex-none",
		"flex-1"
	].includes(base)) return "flex-grow-shorthand";
	if (DISPLAY_CLASSES.has(base)) return "display";
	if (VISIBILITY_CLASSES.has(base)) return "visibility";
	const size = sizeFamily(base);
	if (size) return size;
	if (BG_POSITION_RE.test(base) || base.startsWith("bg-position-")) return "background-position";
	if (base.startsWith("bg-") && !NON_COLOR_BG_RE.test(base)) return "background-color";
	if (FONT_FAMILY_RE$1.test(base) || FONT_ARBITRARY_FAMILY_RE.test(base)) return "font-family";
	if (ORIGIN_RE.test(base)) return "transform-origin";
	if (base.startsWith("leading-")) return "line-height";
	const rounded = ROUNDED_RE.exec(base);
	if (rounded) return `border-radius:${rounded[1] ?? "all"}`;
	const dynamic = /^-?([a-z-]+?)-\d+(?:\.\d+)?$/.exec(base);
	if (dynamic && DYNAMIC_NUMERIC_RE.test(base)) return `dynamic:${dynamic[1]}`;
	return propForBase(base);
}
/** an existing token on the same property + variant that `cls` would collide with */
function conflictingToken(cls, tokens) {
	const { variant, base } = splitVariant(cls);
	const key = propKey(base);
	if (!key) return void 0;
	return tokens.find((t) => {
		const s = splitVariant(t);
		return s.variant === variant && s.base !== base && propKey(s.base) === key;
	});
}
/**
* The prerequisite class `cls` needs (matched to its own variant) when it maps
* to a display-gated property and no matching display is present yet — e.g.
* `flex-row` → `flex`, `grid-cols-3` → `grid`, `hover:flex-row` → `hover:flex`.
*/
function prerequisiteFor(cls, tokens) {
	const { variant, base } = splitVariant(cls);
	const r = propForBase(base)?.relevance;
	if (!r || r.when !== "display") return void 0;
	if (hasDisplayClass(tokens)) return void 0;
	return `${variant}${r.values.includes("flex") ? "flex" : r.values[0]}`;
}
/** true when two bare classes control the same CSS property (e.g. `flex-row`
* and `flex-col`, or `p-2` and `p-4`) — used to resolve per-breakpoint overrides */
function sameProperty(a, b) {
	if (a === b) return true;
	const ka = propKey(a);
	return ka !== void 0 && ka === propKey(b);
}
/** families where an off-scale value really is expressible as `prefix-[value]`.
* The old hint split ANY class at its last dash and offered the arbitrary form,
* which produced invalid advice for keyword utilities — `origin-top-left` became
* "use origin-top-[…]", a class that does not exist. */
var ARBITRARY_CAPABLE = /^(?:p[xytblr]?|m[xytblr]?|gap(?:-[xy])?|w|h|size|min-w|min-h|max-w|max-h|basis|top|right|bottom|left|inset(?:-[xy])?|translate-[xy]|scale|scale-[xy]|rotate|z|opacity|leading|tracking|text|bg|border|rounded|blur|duration|delay|grid-cols|grid-rows|col-span|row-span|aspect|shadow|outline|ring)$/;
/**
* Why a class was rejected and what to try instead: the arbitrary form when the
* family supports one, plus the nearest real classes from the vocabulary. Both
* halves matter — "not a known class" alone leaves a caller guessing, and a
* fabricated arbitrary form sends them somewhere that silently does nothing.
*/
function unknownClassHint(value) {
	const { variants, base } = splitClassVariants(value);
	const variant = variants.length ? `${variants.join(":")}:` : "";
	const parts = [];
	const tokenish = /^(?:bg|text|border|outline|ring|accent|decoration|divide)-([a-z][a-z0-9-]*)$/.exec(base);
	if (tokenish && !TOKEN_CLASSES.includes(base)) parts.push(`if "${tokenish[1]}" is meant to be a design token, no token with that name exists yet — save it in the project settings first`);
	const dash = base.lastIndexOf("-");
	const prefix = dash > 0 ? base.slice(0, dash) : "";
	if (prefix && ARBITRARY_CAPABLE.test(prefix)) parts.push(`for an off-scale value use the arbitrary form "${variant}${prefix}-[…]"`);
	const near = suggestClasses(base, 3).filter((c) => c !== base && !c.endsWith(":"));
	if (near.length) parts.push(`did you mean ${near.map((c) => `"${variant}${c}"`).join(", ")}?`);
	return parts.length ? ` — ${parts.join("; ")}` : "";
}
/**
* Validates a typed class against the current token list and returns the
* resulting tokens (conflict replaced, prerequisite auto-added) or an error.
* `prerequisites: false` skips the flex/grid prerequisite injection — used by
* fields (e.g. an interaction's to-state) where a display class shouldn't be
* added implicitly.
*/
function applyClass(cls, tokens, opts = {}) {
	const value = cls.trim();
	if (!value) return { error: "" };
	if (!isValidClass(value)) return { error: `"${value}" is not a known class${unknownClassHint(value)}` };
	if (tokens.includes(value)) return { error: `${value} is already added` };
	let next = [...tokens];
	const conflict = conflictingToken(value, next);
	if (conflict) next = next.filter((t) => t !== conflict);
	next.push(value);
	if (opts.prerequisites !== false) {
		const prereq = prerequisiteFor(value, next);
		if (prereq && !next.includes(prereq)) next.unshift(prereq);
	}
	return { tokens: next };
}
//#endregion
//#region src/lib/shared/urls.js
/** hrefs: same-site paths/fragments plus the safe external schemes */
var SAFE_HREF = /^(\/|#|https?:|mailto:|tel:)/i;
/** media src/background: the href allowlist plus inline image/video data
* URLs. Blocks javascript:/data:text-html etc. — harmless today (no
* iframe/script element exists) but a hard gate before any such element
* is ever added. */
var SAFE_SRC = /^(\/|#|https?:|mailto:|tel:|data:image\/|data:video\/)/i;
//#endregion
//#region src/lib/shared/richtext.js
var ALLOWED = {
	b: {},
	strong: {},
	i: {},
	em: {},
	u: {},
	mark: {},
	code: {},
	sup: {},
	sub: {},
	br: { void: true },
	hr: { void: true },
	p: {},
	h2: {},
	h3: {},
	h4: {},
	blockquote: {},
	ul: {},
	ol: {},
	li: {},
	a: { href: true }
};
var escapeText = (s) => s.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
var escapeAttr = (s) => s.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;");
/** true when a string uses any of the allowed rich tags */
function isRich(value) {
	return typeof value === "string" && /<\/?(b|strong|i|em|u|mark|code|sup|sub|a|ul|ol|li|br|hr|p|h2|h3|h4|blockquote)[\s>/]/i.test(value);
}
/** sanitize a rich-text fragment to the allowed subset (idempotent) */
function sanitizeRich(html) {
	if (typeof html !== "string" || !html) return "";
	const out = [];
	const open = [];
	for (const token of html.match(/<[^>]*>|[^<]+|</g) ?? []) {
		if (token[0] !== "<" || token.length === 1) {
			out.push(escapeText(token));
			continue;
		}
		const match = token.match(/^<(\/?)([a-zA-Z0-9]+)([^>]*)>$/);
		if (!match) {
			out.push(escapeText(token));
			continue;
		}
		const closing = match[1] === "/";
		const tag = match[2].toLowerCase();
		const spec = ALLOWED[tag];
		if (!spec) continue;
		if (spec.void) {
			if (!closing) out.push(`<${tag}>`);
			continue;
		}
		if (closing) {
			const at = open.lastIndexOf(tag);
			if (at === -1) continue;
			for (let i = open.length - 1; i >= at; i--) out.push(`</${open[i]}>`);
			open.length = at;
			continue;
		}
		if (tag === "a") {
			const href = match[3].match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
			const raw = (href?.[1] ?? href?.[2] ?? href?.[3] ?? "").trim();
			const safe = SAFE_HREF.test(raw) ? raw : "";
			out.push(safe ? `<a href="${escapeAttr(safe)}" rel="noopener">` : "<a>");
		} else out.push(`<${tag}>`);
		open.push(tag);
	}
	for (let i = open.length - 1; i >= 0; i--) out.push(`</${open[i]}>`);
	return out.join("");
}
//#endregion
//#region src/lib/shared/attributes.js
/** attribute names allowed verbatim */
var ATTR_ALLOW = /* @__PURE__ */ new Set([
	"target",
	"rel",
	"download",
	"title",
	"role",
	"type",
	"name",
	"value",
	"placeholder",
	"alt",
	"loading",
	"tabindex",
	"lang",
	"dir",
	"hidden",
	"disabled",
	"open",
	"for",
	"required",
	"readonly",
	"checked",
	"selected",
	"multiple",
	"autofocus",
	"autocomplete",
	"min",
	"max",
	"step",
	"rows",
	"cols",
	"maxlength",
	"minlength",
	"pattern",
	"inputmode",
	"accept",
	"translate"
]);
/** allowed name prefixes (data-*, aria-*) */
var ATTR_PREFIXES = ["data-", "aria-"];
/** a syntactically valid attribute name (lowercase, no colons/uppercase) */
var NAME_RE = /^[a-z][a-z0-9-]*$/;
/** is `name` an allowed custom attribute? */
function isAllowedAttribute(name) {
	const n = String(name).toLowerCase().trim();
	if (!NAME_RE.test(n)) return false;
	if (ATTR_ALLOW.has(n)) return true;
	return ATTR_PREFIXES.some((p) => n.startsWith(p) && n.length > p.length);
}
/**
* Keep only allowed attributes, lowercased names with string values. Returns a
* fresh object (never mutates the input).
*
* EMPTY VALUES ARE KEPT. They used to be dropped, which made `alt=""` (the
* correct markup for a decorative image) and every boolean attribute
* (`download`, `hidden`, `required`) unexpressible — and because callers infer
* the rejection reason by diffing key names, the loss was reported as
* "attribute not allowed", pointing at the wrong thing entirely.
*
* `true` coerces to the empty string (so an agent can pass a real boolean) and
* `false` drops the attribute (absence IS false for booleans).
*/
function sanitizeAttributes(record) {
	/** @type {Record<string, string>} */
	const out = {};
	if (!record || typeof record !== "object" || Array.isArray(record)) return out;
	for (const [rawName, rawValue] of Object.entries(record)) {
		const name = String(rawName).toLowerCase().trim();
		if (!isAllowedAttribute(name)) continue;
		if (rawValue === false) continue;
		out[name] = rawValue == null || rawValue === true ? "" : String(rawValue);
	}
	return out;
}
//#endregion
//#region src/lib/shared/locales.js
/** delete a locale's SEO overrides everywhere, pruning emptied containers so a
*  touch-then-clear leaves the blob byte-identical (keeps merge signatures
*  stable, same rule as node/entry overrides) */
function purgeLocaleSeo(project, code) {
	for (const page of project.pages ?? []) {
		const seo = page.seo;
		if (!seo?.locales?.[code]) continue;
		delete seo.locales[code];
		if (!Object.keys(seo.locales).length) delete seo.locales;
		if (!Object.keys(seo).length) delete page.seo;
	}
	const settingsSeo = project.settings?.seo;
	if (settingsSeo?.locales?.[code]) {
		delete settingsSeo.locales[code];
		if (!Object.keys(settingsSeo.locales).length) delete settingsSeo.locales;
	}
}
/** how many SEO overrides a locale holds (one per page bucket, one for the
*  project bucket) — so a removal refusal counts what it would really destroy */
function countLocaleSeo(project, code) {
	let n = 0;
	for (const page of project.pages ?? []) if (page.seo?.locales?.[code]) n++;
	if (project.settings?.seo?.locales?.[code]) n++;
	return n;
}
//#endregion
//#region src/lib/shared/tokens.js
var TOKEN_NAME_RE = /^[a-z][a-z0-9-]*$/;
var HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
var RESERVED_TOKEN_NAMES = /* @__PURE__ */ new Set([
	"slate",
	"gray",
	"red",
	"orange",
	"amber",
	"yellow",
	"lime",
	"green",
	"emerald",
	"teal",
	"cyan",
	"sky",
	"blue",
	"indigo",
	"violet",
	"purple",
	"fuchsia",
	"pink",
	"rose",
	"neutral",
	"stone",
	"zinc",
	"white",
	"black",
	"transparent",
	"current",
	"inherit"
]);
/**
* Why a token is malformed, or null. Shadowing a palette name is NOT malformed —
* see isReservedToken.
* @returns {string|null}
*/
function tokenError(token) {
	if (!TOKEN_NAME_RE.test(token?.name ?? "")) return "token names are kebab-case ([a-z][a-z0-9-]*)";
	if (!HEX_RE.test(token?.value ?? "")) return "token values are #hex colours";
	return null;
}
/**
* Does this name shadow a Tailwind palette name or colour keyword?
*
* A token compiles to `--color-<name>`, so `blue` defines `bg-blue` — it does
* NOT redefine `bg-blue-500`, which is a different variable. So this is a
* legibility hazard, not a breakage: a real brand palette genuinely has colours
* called "blue" and "orange", and forcing every one of them to be renamed (and
* every class rewritten to `bg-brand-blue`) was friction with no safety payoff.
* Callers warn; they no longer refuse.
*/
function isReservedToken(name) {
	return RESERVED_TOKEN_NAMES.has(String(name));
}
/** well-formed AND not shadowing a palette name — the conservative default */
function isValidToken(token) {
	return tokenError(token) === null && !isReservedToken(token.name);
}
/** well-formed, shadowing allowed — what actually reaches the @theme block, so
* a deliberately-shadowing token really does render */
function isEmittableToken(token) {
	return tokenError(token) === null;
}
var LENGTH_RE = /^-?\d*\.?\d+(?:px|rem|em|%|vw|vh|ch|ex|pt)?$/;
var FUNC_RE = /^(?:clamp|calc|min|max)\([-+*/\s\d.a-z%(),]*\)$/i;
/** a CSS length/number safe to emit into a custom property */
function isThemeValue(value) {
	const v = String(value ?? "").trim();
	if (!v || v.length > 64) return false;
	if (v.includes(";") || v.includes("}") || v.includes("{")) return false;
	return LENGTH_RE.test(v) || FUNC_RE.test(v);
}
//#endregion
//#region src/lib/shared/fonts.js
/** …and the same by file extension, for https URLs that never went through
*  the library (the mime isn't knowable without fetching) */
var FORMAT_BY_EXT = {
	woff2: "woff2",
	woff: "woff",
	ttf: "truetype",
	otf: "opentype",
	ttc: "truetype"
};
var FONT_FORMATS = [
	"woff2",
	"woff",
	"truetype",
	"opentype"
];
/** the `format()` hint guessed from a URL's extension, or undefined */
function fontFormatForUrl(url) {
	return FORMAT_BY_EXT[String(url ?? "").toLowerCase().split(/[?#]/)[0].split(".").pop()];
}
/** family names are interpolated into CSS, so they are restricted to the same
*  safe character set as settings.fonts.family — letters, digits, spaces and
*  hyphens. Anything else could close the declaration and inject rules. */
var FONT_FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 -]*$/;
/** a weight the CSS accepts: 100–900, or a variable-font range ("100 900") */
var WEIGHT_RE = /^(?:[1-9]00|normal|bold)(?: (?:[1-9]00))?$/;
/** only same-origin media paths and https URLs may be fetched as fonts —
*  mirrors SAFE_SRC's intent, minus the data:/mailto:/tel: cases that make no
*  sense for a font file */
var SAFE_FONT_SRC = /^(?:\/|https:\/\/)/i;
/** human-readable reason a font entry is unusable, or null when it is fine */
function fontError(font, others = []) {
	const family = String(font?.family ?? "").trim();
	if (!family) return "Family name required";
	if (!FONT_FAMILY_RE.test(family)) return "Letters, digits, spaces and hyphens only";
	if (others.some((f) => f !== font && String(f.family ?? "").trim().toLowerCase() === family.toLowerCase() && (f.weight ?? "400") === (font.weight ?? "400") && (f.style ?? "normal") === (font.style ?? "normal"))) return "Another font already uses this family, weight and style";
	if (!font?.src) return "Pick a font file";
	if (!SAFE_FONT_SRC.test(font.src)) return "Font files must be a /media/… path or an https:// URL";
	if (font.weight && !WEIGHT_RE.test(String(font.weight))) return "Weight is 100–900, or a range like \"100 900\"";
	return null;
}
//#endregion
//#region src/lib/shared/motion.js
/**
* Every tweenable property: how it reaches CSS, its default unit, the units it
* accepts, and the neutral value used when a track omits `from` and the caller
* can't measure one. `kind` groups properties that compose into one CSS
* declaration.
*/
var LENGTH_UNITS = [
	"px",
	"%",
	"em",
	"rem",
	"vw",
	"vh"
];
var MOTION_PROPS = {
	x: {
		kind: "transform",
		unit: "px",
		units: LENGTH_UNITS,
		def: 0,
		label: "Move X"
	},
	y: {
		kind: "transform",
		unit: "px",
		units: LENGTH_UNITS,
		def: 0,
		label: "Move Y"
	},
	scale: {
		kind: "transform",
		unit: "",
		units: [],
		def: 1,
		label: "Scale"
	},
	rotate: {
		kind: "transform",
		unit: "deg",
		units: ["deg"],
		def: 0,
		label: "Rotate"
	},
	opacity: {
		kind: "opacity",
		unit: "",
		units: [],
		def: 1,
		label: "Opacity"
	},
	blur: {
		kind: "filter",
		unit: "px",
		units: [
			"px",
			"em",
			"rem"
		],
		def: 0,
		label: "Blur"
	},
	brightness: {
		kind: "filter",
		unit: "",
		units: [],
		def: 1,
		label: "Brightness"
	},
	saturate: {
		kind: "filter",
		unit: "",
		units: [],
		def: 1,
		label: "Saturate"
	},
	bgColor: {
		kind: "color",
		css: "backgroundColor",
		unit: "",
		units: [],
		def: "#00000000",
		label: "Background"
	},
	textColor: {
		kind: "color",
		css: "color",
		unit: "",
		units: [],
		def: "#00000000",
		label: "Text color"
	},
	borderColor: {
		kind: "color",
		css: "borderColor",
		unit: "",
		units: [],
		def: "#00000000",
		label: "Border color"
	},
	width: {
		kind: "size",
		css: "width",
		unit: "px",
		units: LENGTH_UNITS,
		def: 0,
		label: "Width"
	},
	height: {
		kind: "size",
		css: "height",
		unit: "px",
		units: LENGTH_UNITS,
		def: 0,
		label: "Height"
	},
	clipTop: {
		kind: "clip",
		unit: "%",
		units: ["%", "px"],
		def: 0,
		label: "Clip top"
	},
	clipRight: {
		kind: "clip",
		unit: "%",
		units: ["%", "px"],
		def: 0,
		label: "Clip right"
	},
	clipBottom: {
		kind: "clip",
		unit: "%",
		units: ["%", "px"],
		def: 0,
		label: "Clip bottom"
	},
	clipLeft: {
		kind: "clip",
		unit: "%",
		units: ["%", "px"],
		def: 0,
		label: "Clip left"
	}
};
var c1 = 1.70158;
var c3 = 2.70158;
var c4 = 2 * Math.PI / 3;
/** Easing functions, all f(0)=0 f(1)=1. Keys are what a step stores. */
var EASINGS = {
	linear: (t) => t,
	"ease-in": (t) => t * t * t,
	"ease-out": (t) => 1 - Math.pow(1 - t, 3),
	"ease-in-out": (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
	"quad-in": (t) => t * t,
	"quad-out": (t) => 1 - (1 - t) * (1 - t),
	"quart-in": (t) => t * t * t * t,
	"quart-out": (t) => 1 - Math.pow(1 - t, 4),
	"quart-in-out": (t) => t < .5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2,
	"back-out": (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
	"elastic-out": (t) => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - .75) * c4) + 1,
	"bounce-out": (t) => {
		const n1 = 7.5625;
		const d1 = 2.75;
		if (t < 1 / d1) return n1 * t * t;
		if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + .75;
		if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + .9375;
		return n1 * (t -= 2.625 / d1) * t + .984375;
	}
};
var EASING_KEYS = Object.keys(EASINGS);
var NUMBER_UNIT_RE = /^\s*(-?\d+(?:\.\d+)?)\s*([a-z%]*)\s*$/i;
/**
* Splits a track value into a number and a unit. Numbers adopt the property's
* default unit; strings carry their own. Returns null when unparseable.
* @param {number|string} value
* @param {string} prop
* @returns {{n: number, unit: string}|null}
*/
function parseTrackValue(value, prop) {
	const meta = MOTION_PROPS[prop];
	if (!meta) return null;
	if (typeof value === "number") return isFinite(value) ? {
		n: value,
		unit: meta.unit
	} : null;
	if (typeof value !== "string") return null;
	const m = NUMBER_UNIT_RE.exec(value);
	if (!m) return null;
	const n = parseFloat(m[1]);
	if (!isFinite(n)) return null;
	const unit = m[2] || meta.unit;
	if (!meta.units.length) return m[2] ? null : {
		n,
		unit: ""
	};
	return meta.units.indexOf(unit) === -1 ? null : {
		n,
		unit
	};
}
/** '#rgb' | '#rrggbb' | '#rrggbbaa' → [r,g,b,a] (a in 0..1); null if unparseable */
function parseColor(value) {
	if (typeof value !== "string") return null;
	const hex = value.trim().replace(/^#/, "");
	if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
	if (hex.length === 3) return [
		parseInt(hex[0] + hex[0], 16),
		parseInt(hex[1] + hex[1], 16),
		parseInt(hex[2] + hex[2], 16),
		1
	];
	if (hex.length === 6 || hex.length === 8) return [
		parseInt(hex.slice(0, 2), 16),
		parseInt(hex.slice(2, 4), 16),
		parseInt(hex.slice(4, 6), 16),
		hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
	];
	return null;
}
var num = (v, fallback) => typeof v === "number" && isFinite(v) ? v : fallback;
/**
* Flattens an Animation's steps into absolute-timed tracks.
* A step starts at the previous step's END plus its `offset` (negative
* overlaps). `duration` is the timeline length ignoring infinite repeats, so
* scrub mapping stays finite.
*
* @param {{steps?: any[]}} animation
* @returns {{tracks: any[], duration: number}}
*/
function compileAnimation(animation) {
	const tracks = [];
	let cursor = 0;
	let end = 0;
	const steps = animation && animation.steps || [];
	for (let s = 0; s < steps.length; s++) {
		const step = steps[s];
		const duration = Math.max(0, num(step.duration, 0));
		const start = Math.max(0, cursor + num(step.offset, 0));
		const repeat = num(step.repeat, 0);
		const iterations = repeat < 0 ? Infinity : repeat + 1;
		const span = duration * (repeat < 0 ? 1 : iterations);
		const easing = EASINGS[step.easing] ? step.easing : "ease-out";
		const stagger = Math.max(0, num(step.stagger, 0));
		for (const track of step.tracks || []) {
			if (!MOTION_PROPS[track.prop]) continue;
			tracks.push({
				prop: track.prop,
				from: track.from,
				to: track.to,
				start,
				duration,
				easing,
				stagger,
				staggerSelector: stagger > 0 ? step.staggerSelector || "" : "",
				repeat: iterations,
				yoyo: !!step.yoyo,
				stepIndex: s
			});
		}
		cursor = start + duration;
		end = Math.max(end, start + span);
	}
	return {
		tracks,
		duration: end
	};
}
var TRIGGERS = [
	"load",
	"appear",
	"scrub",
	"hover",
	"click"
];
/** `once` is explicit; a binding that omits appearMode inherits the site
* default (settings.motion.appearMode) — see effectiveAppearMode */
var APPEAR_MODES = [
	"once",
	"replay",
	"reverse"
];
var SELECTOR_RE = /^[\w\s.#>~*:+\-[\]="',()]{1,120}$/;
var fail$1 = (error) => ({
	ok: false,
	error
});
/**
* @param {any} animation
* @returns {{ok: true} | {ok: false, error: string}}
*/
function validateAnimation(animation) {
	if (!animation || typeof animation !== "object") return fail$1("animation must be an object");
	if (typeof animation.name !== "string" || !animation.name.trim()) return fail$1("animation needs a name");
	if (!Array.isArray(animation.steps) || !animation.steps.length) return fail$1("animation needs at least one step");
	for (let i = 0; i < animation.steps.length; i++) {
		const step = animation.steps[i];
		const at = `step ${i + 1}`;
		if (!step || typeof step !== "object") return fail$1(`${at} must be an object`);
		if (!Array.isArray(step.tracks) || !step.tracks.length) return fail$1(`${at} needs at least one property`);
		if (typeof step.duration !== "number" || !isFinite(step.duration) || step.duration < 0) return fail$1(`${at} duration must be a non-negative number of milliseconds`);
		if (typeof step.easing !== "string" || !EASINGS[step.easing]) return fail$1(`${at} easing must be one of: ${EASING_KEYS.join(", ")}`);
		if (step.repeat !== void 0 && (typeof step.repeat !== "number" || step.repeat < -1)) return fail$1(`${at} repeat must be a number (-1 for infinite)`);
		if (step.stagger !== void 0 && (typeof step.stagger !== "number" || step.stagger < 0)) return fail$1(`${at} stagger must be a non-negative number of milliseconds`);
		if (step.staggerSelector !== void 0) {
			if (typeof step.staggerSelector !== "string" || !SELECTOR_RE.test(step.staggerSelector)) return fail$1(`${at} staggerSelector must be a simple CSS selector (max 120 chars)`);
			if (!step.stagger) return fail$1(`${at} has a staggerSelector but no stagger`);
		}
		for (const track of step.tracks) {
			if (!track || !MOTION_PROPS[track.prop]) return fail$1(`${at} has an unknown property "${track && track.prop}" — use one of: ${Object.keys(MOTION_PROPS).join(", ")}`);
			const meta = MOTION_PROPS[track.prop];
			if (track.to === void 0 || track.to === null || track.to === "") return fail$1(`${at} property "${track.prop}" needs a "to" value`);
			if (meta.kind === "color") {
				if (!parseColor(track.to)) return fail$1(`${at} property "${track.prop}" needs a hex color`);
				if (track.from !== void 0 && !parseColor(track.from)) return fail$1(`${at} property "${track.prop}" "from" must be a hex color`);
				continue;
			}
			const units = meta.units.length ? ` (units: ${meta.units.join(", ")})` : " (no unit)";
			const to = parseTrackValue(track.to, track.prop);
			if (!to) return fail$1(`${at} property "${track.prop}" has an invalid "to" value${units}`);
			if (track.from !== void 0 && track.from !== null) {
				const from = parseTrackValue(track.from, track.prop);
				if (!from) return fail$1(`${at} property "${track.prop}" has an invalid "from" value${units}`);
				if (typeof track.from === "string" && typeof track.to === "string" && from.unit !== to.unit) return fail$1(`${at} property "${track.prop}" mixes units ("${from.unit}" → "${to.unit}") — use the same unit on both sides`);
			}
		}
	}
	return { ok: true };
}
/**
* @param {any} binding
* @param {{animationIds?: string[]}} [ctx]
* @returns {{ok: true} | {ok: false, error: string}}
*/
function validateBinding(binding, ctx) {
	if (!binding || typeof binding !== "object") return fail$1("binding must be an object");
	if (typeof binding.animationId !== "string" || !binding.animationId) return fail$1("binding needs an animationId");
	const known = ctx && ctx.animationIds;
	if (known && known.indexOf(binding.animationId) === -1) return fail$1(`no animation "${binding.animationId}" in the library`);
	if (TRIGGERS.indexOf(binding.trigger) === -1) return fail$1(`trigger must be one of: ${TRIGGERS.join(", ")}`);
	if (binding.appearMode !== void 0 && APPEAR_MODES.indexOf(binding.appearMode) === -1) return fail$1(`appearMode must be one of: ${APPEAR_MODES.join(", ")}`);
	if (binding.appearAt !== void 0) {
		if (typeof binding.appearAt !== "number" || binding.appearAt < 0 || binding.appearAt > 1) return fail$1("appearAt must be a number between 0 and 1 (viewport fraction)");
	}
	if (binding.scrub !== void 0) {
		if (typeof binding.scrub !== "object" || binding.scrub === null) return fail$1("scrub must be an object with start/end");
		for (const k of ["start", "end"]) {
			const v = binding.scrub[k];
			if (v !== void 0 && (typeof v !== "number" || !isFinite(v))) return fail$1(`scrub.${k} must be a number`);
		}
		const smooth = binding.scrub.smooth;
		if (smooth !== void 0 && (typeof smooth !== "number" || !isFinite(smooth) || smooth < 0 || smooth > 3)) return fail$1("scrub.smooth must be a number of seconds between 0 and 3");
	}
	return { ok: true };
}
/** shared constants — never re-spell these as literals in a consumer */
var TRANSITION_DEFAULTS = {
	preset: "fade",
	/** enter duration, ms */
	duration: 500,
	easing: "ease-out",
	/** leaving should feel quicker than arriving */
	exitRatio: .75,
	/** hard cap on how long a click may wait for the exit timeline: a broken or
	* infinite custom animation must never strand the visitor on the old page */
	exitTimeoutMs: 1500,
	maxDuration: 5e3
};
/**
* The built-in exit/enter track pairs, played on the page `body`.
* Offsets are deliberately small: any transform or filter on body makes it the
* containing block for `position: fixed` descendants, so a fixed header rides
* along for the duration of the transition. `fade` avoids that entirely and is
* the default for exactly that reason.
*/
var TRANSITION_PRESETS = {
	fade: {
		label: "Fade",
		exit: [{
			prop: "opacity",
			from: 1,
			to: 0
		}],
		enter: [{
			prop: "opacity",
			from: 0,
			to: 1
		}]
	},
	"slide-up": {
		label: "Slide up",
		exit: [{
			prop: "y",
			from: 0,
			to: -32
		}, {
			prop: "opacity",
			from: 1,
			to: 0
		}],
		enter: [{
			prop: "y",
			from: 32,
			to: 0
		}, {
			prop: "opacity",
			from: 0,
			to: 1
		}]
	},
	"slide-down": {
		label: "Slide down",
		exit: [{
			prop: "y",
			from: 0,
			to: 32
		}, {
			prop: "opacity",
			from: 1,
			to: 0
		}],
		enter: [{
			prop: "y",
			from: -32,
			to: 0
		}, {
			prop: "opacity",
			from: 0,
			to: 1
		}]
	},
	"slide-left": {
		label: "Slide left",
		exit: [{
			prop: "x",
			from: 0,
			to: -48
		}, {
			prop: "opacity",
			from: 1,
			to: 0
		}],
		enter: [{
			prop: "x",
			from: 48,
			to: 0
		}, {
			prop: "opacity",
			from: 0,
			to: 1
		}]
	},
	"slide-right": {
		label: "Slide right",
		exit: [{
			prop: "x",
			from: 0,
			to: 48
		}, {
			prop: "opacity",
			from: 1,
			to: 0
		}],
		enter: [{
			prop: "x",
			from: -48,
			to: 0
		}, {
			prop: "opacity",
			from: 0,
			to: 1
		}]
	},
	zoom: {
		label: "Zoom",
		exit: [{
			prop: "scale",
			from: 1,
			to: .97
		}, {
			prop: "opacity",
			from: 1,
			to: 0
		}],
		enter: [{
			prop: "scale",
			from: 1.03,
			to: 1
		}, {
			prop: "opacity",
			from: 0,
			to: 1
		}]
	},
	blur: {
		label: "Blur",
		exit: [{
			prop: "blur",
			from: 0,
			to: 8
		}, {
			prop: "opacity",
			from: 1,
			to: 0
		}],
		enter: [{
			prop: "blur",
			from: 8,
			to: 0
		}, {
			prop: "opacity",
			from: 0,
			to: 1
		}]
	}
};
var TRANSITION_PRESET_IDS = Object.keys(TRANSITION_PRESETS);
var SCROLL_LERP_MIN = .02;
var SCROLL_LERP_MAX = .4;
/**
* @param {any} motion — a candidate settings.motion
* @param {{animationIds?: string[]}} [ctx]
* @returns {{ok: true} | {ok: false, error: string}}
*/
function validateMotionSettings(motion, ctx) {
	if (motion === void 0 || motion === null) return { ok: true };
	if (typeof motion !== "object" || Array.isArray(motion)) return fail$1("motion must be an object");
	if (motion.appearMode !== void 0 && APPEAR_MODES.indexOf(motion.appearMode) === -1) return fail$1(`motion.appearMode must be one of: ${APPEAR_MODES.join(", ")}`);
	const t = motion.transitions;
	if (t !== void 0 && t !== null) {
		if (typeof t !== "object" || Array.isArray(t)) return fail$1("motion.transitions must be an object");
		if (typeof t.enabled !== "boolean") return fail$1("motion.transitions.enabled must be a boolean");
		if (t.preset !== void 0 && t.preset !== "custom" && !TRANSITION_PRESETS[t.preset]) return fail$1(`motion.transitions.preset must be "custom" or one of: ${TRANSITION_PRESET_IDS.join(", ")}`);
		if (t.duration !== void 0 && (typeof t.duration !== "number" || !isFinite(t.duration) || t.duration < 0 || t.duration > TRANSITION_DEFAULTS.maxDuration)) return fail$1(`motion.transitions.duration must be between 0 and ${TRANSITION_DEFAULTS.maxDuration} ms`);
		if (t.easing !== void 0 && !EASINGS[t.easing]) return fail$1(`motion.transitions.easing must be one of: ${EASING_KEYS.join(", ")}`);
		const known = ctx && ctx.animationIds;
		for (const key of ["exitAnimationId", "enterAnimationId"]) {
			const id = t[key];
			if (id === void 0 || id === null) continue;
			if (typeof id !== "string" || !id) return fail$1(`motion.transitions.${key} must be an animation id`);
			if (known && known.indexOf(id) === -1) return fail$1(`no animation "${id}" in the library`);
		}
	}
	const s = motion.scroll;
	if (s !== void 0 && s !== null) {
		if (typeof s !== "object" || Array.isArray(s)) return fail$1("motion.scroll must be an object");
		if (typeof s.enabled !== "boolean") return fail$1("motion.scroll.enabled must be a boolean");
		if (s.lerp !== void 0 && (typeof s.lerp !== "number" || !isFinite(s.lerp) || s.lerp < .02 || s.lerp > .4)) return fail$1(`motion.scroll.lerp must be between ${SCROLL_LERP_MIN} and ${SCROLL_LERP_MAX}`);
	}
	return { ok: true };
}
//#endregion
//#region src/lib/settings.ts
function defaultSettings() {
	return {
		favicon: void 0,
		publishing: {
			method: "server",
			github: {
				repo: "",
				branch: "main"
			}
		},
		seo: {
			siteName: "",
			titleTemplate: "%s",
			description: "",
			ogImage: void 0
		},
		domain: "",
		smtp: {
			host: "",
			port: "",
			user: "",
			password: "",
			from: ""
		},
		integrations: {
			stripe: { publishableKey: "" },
			mailing: { provider: "" }
		},
		tokens: [],
		customCode: { head: "" },
		fonts: {
			family: "",
			googleFontsUrl: void 0,
			custom: []
		}
	};
}
//#endregion
//#region src/lib/shared/slider.js
/** slides visible at once is capped so a typo can't emit a 10000-column track */
var PER_VIEW_MIN = 1;
var PER_VIEW_MAX = 8;
var GAP_MAX = 500;
var DELAY_MIN = 500;
var DELAY_MAX = 6e4;
var SLIDER_DEFAULTS = {
	arrows: true,
	dots: true,
	gap: 0,
	autoplay: false,
	delay: 4e3,
	loop: false,
	drag: true
};
/** the perView key for the widest breakpoint — the value that applies everywhere
* until a narrower breakpoint overrides it (desktop-first, like the class cascade) */
var PER_VIEW_BASE = "base";
var SLIDER_KEYS = [
	"arrows",
	"dots",
	"perView",
	"gap",
	"autoplay",
	"delay",
	"loop",
	"drag"
];
var fail = (error) => ({
	ok: false,
	error
});
var isBool = (v) => typeof v === "boolean";
var isNum = (v) => typeof v === "number" && isFinite(v);
/**
* @param {any} config
* @param {{breakpointIds?: string[]}} [ctx] when given, perView keys are checked
*   against the project's real breakpoints (the MCP path — the editor only ever
*   writes keys it just read off the project)
* @returns {{ok: true} | {ok: false, error: string}}
*/
function validateSliderConfig(config, ctx = {}) {
	if (!config || typeof config !== "object" || Array.isArray(config)) return fail("slider must be an object");
	for (const key of Object.keys(config)) if (!SLIDER_KEYS.includes(key)) return fail(`unknown slider option '${key}' — use one of: ${SLIDER_KEYS.join(", ")}`);
	for (const key of [
		"arrows",
		"dots",
		"autoplay",
		"loop",
		"drag"
	]) if (config[key] !== void 0 && !isBool(config[key])) return fail(`slider ${key} must be true or false`);
	if (config.gap !== void 0 && (!isNum(config.gap) || config.gap < 0 || config.gap > GAP_MAX)) return fail(`slider gap must be a number of pixels between 0 and ${GAP_MAX}`);
	if (config.delay !== void 0 && (!isNum(config.delay) || config.delay < DELAY_MIN || config.delay > DELAY_MAX)) return fail(`slider delay must be a number of milliseconds between ${DELAY_MIN} and ${DELAY_MAX}`);
	if (config.perView !== void 0) {
		const pv = config.perView;
		if (!pv || typeof pv !== "object" || Array.isArray(pv)) return fail(`slider perView must be an object keyed by '${PER_VIEW_BASE}' and breakpoint ids`);
		for (const [key, value] of Object.entries(pv)) {
			if (key !== "base" && ctx.breakpointIds && !ctx.breakpointIds.includes(key)) return fail(`slider perView key '${key}' is not a breakpoint — use '${PER_VIEW_BASE}'` + (ctx.breakpointIds.length ? ` or one of: ${ctx.breakpointIds.join(", ")}` : ""));
			if (!isNum(value) || !Number.isInteger(value) || value < PER_VIEW_MIN || value > PER_VIEW_MAX) return fail(`slider perView '${key}' must be a whole number of slides between ${PER_VIEW_MIN} and ${PER_VIEW_MAX}`);
		}
	}
	return { ok: true };
}
/**
* A fully-defaulted config. Deliberately TOLERANT where the validator is
* strict: a perView key for a breakpoint the user has since deleted is dropped
* rather than failing, so a stale config never breaks a render.
*
* @param {any} config node.slider, possibly undefined
* @param {{id: string, width: number}[]} [breakpoints] project.breakpoints
*/
function resolveSliderConfig(config, breakpoints = []) {
	const c = config && typeof config === "object" ? config : {};
	const known = new Set(breakpoints.map((b) => b.id));
	const perView = {};
	for (const [key, value] of Object.entries(c.perView ?? {})) {
		if (key !== "base" && !known.has(key)) continue;
		if (!isNum(value)) continue;
		perView[key] = Math.min(PER_VIEW_MAX, Math.max(PER_VIEW_MIN, Math.round(value)));
	}
	return {
		arrows: isBool(c.arrows) ? c.arrows : SLIDER_DEFAULTS.arrows,
		dots: isBool(c.dots) ? c.dots : SLIDER_DEFAULTS.dots,
		gap: isNum(c.gap) ? Math.max(0, Math.min(GAP_MAX, c.gap)) : SLIDER_DEFAULTS.gap,
		autoplay: isBool(c.autoplay) ? c.autoplay : SLIDER_DEFAULTS.autoplay,
		delay: isNum(c.delay) ? Math.max(DELAY_MIN, Math.min(DELAY_MAX, c.delay)) : SLIDER_DEFAULTS.delay,
		loop: isBool(c.loop) ? c.loop : SLIDER_DEFAULTS.loop,
		drag: isBool(c.drag) ? c.drag : SLIDER_DEFAULTS.drag,
		perView
	};
}
var SLIDER_DOT_BASE = "size-2 rounded-full transition-colors";
`${SLIDER_DOT_BASE}`;
`${SLIDER_DOT_BASE}`;
//#endregion
//#region src/lib/shared/interactionKeys.js
/**
* The key interaction STATE is held under: one boolean per (interaction, target)
* within a scope, so any number of triggers drive the same effect.
* @param {string} interactionId
* @param {string} targetId the node the classes land on (never null — callers
*   resolve `binding.targetId ?? ownerId` first)
* @param {string} [scope] component instance + collection-list repeat isolation
* @returns {string}
*/
function interactionStateKey(interactionId, targetId, scope) {
	const base = `${interactionId}:${targetId}`;
	return scope ? `${base}@${scope}` : base;
}
/**
* The key an exclusive GROUP is tracked under. Deliberately scoped to the
* component INSTANCE only and never to the collection-list repeat: "one
* accordion open at a time" has to hold ACROSS the repeats of one list (that is
* the whole point), while two instances of the same component stay independent.
* @param {string} group author-chosen group name
* @param {string} [instanceScope] the component instance part of the scope only
* @returns {string}
*/
function interactionGroupKey(group, instanceScope) {
	return instanceScope ? `${group}@${instanceScope}` : group;
}
/** what a trigger does to its target's state. `toggle` is the default. */
var INTERACTION_ACTIONS = [
	"toggle",
	"on",
	"off"
];
/** every trigger an interaction binding can use.
* hover   — on while the pointer is over the trigger (symmetric, ignores action)
* click   — on click; honours action
* appear  — first time the trigger scrolls into view (fires once, never unfires)
* scrolled— while the page is scrolled past `scrollAt` px (symmetric)
* change  — an input's checked/non-empty state (symmetric, for conditional fields) */
var INTERACTION_TRIGGERS = [
	"hover",
	"click",
	"appear",
	"scrolled",
	"change"
];
/** user gestures that dismiss (force OFF) a fired interaction */
var INTERACTION_CLOSE_ON = ["outside", "escape"];
/** where a `once` binding remembers its state */
var INTERACTION_ONCE = ["session", "local"];
/** default scroll offset (px) for the `scrolled` trigger */
var DEFAULT_SCROLL_AT = 50;
/** triggers whose state is derived from a condition and so ignore `action`
* (firing and unfiring are both driven by the trigger itself) */
var SYMMETRIC_TRIGGERS = /* @__PURE__ */ new Set([
	"hover",
	"scrolled",
	"change"
]);
/** true when the trigger drives state in both directions on its own */
function isSymmetricTrigger(trigger) {
	return SYMMETRIC_TRIGGERS.has(trigger);
}
//#endregion
//#region src/lib/factories.ts
function defaultBreakpoints() {
	return [
		{
			id: crypto.randomUUID(),
			name: "Desktop",
			width: 1440,
			height: 900
		},
		{
			id: crypto.randomUUID(),
			name: "Tablet",
			width: 768,
			height: 1024
		},
		{
			id: crypto.randomUUID(),
			name: "Mobile",
			width: 390,
			height: 844
		}
	];
}
function createPage(name, path, locale = "en") {
	const code = buildDocument({
		name,
		slug: path,
		status: "published",
		locale
	}, []);
	const now = Date.now();
	return {
		id: crypto.randomUUID(),
		name,
		path,
		status: "published",
		code,
		elements: parseSyntax(code),
		createdAt: now,
		updatedAt: now
	};
}
function createProject(name) {
	return {
		id: crypto.randomUUID(),
		name,
		pages: [createPage("Home", "/")],
		components: [],
		collections: [],
		interactions: [],
		animations: [],
		breakpoints: defaultBreakpoints(),
		comments: [],
		locales: ["en"],
		defaultLocale: "en",
		settings: defaultSettings()
	};
}
//#endregion
export { APPEAR_MODES, BUILTIN_LIST_SOURCES, DEFAULT_SCROLL_AT, EASINGS, EASING_KEYS, ELEMENTS, FONT_FORMATS, HEX_RE, INTERACTION_ACTIONS, INTERACTION_CLOSE_ON, INTERACTION_ONCE, INTERACTION_TRIGGERS, MOTION_PROPS, NODE_STATE_KEYS, REF_SLOT, RESERVED_TOKEN_NAMES, SAFE_HREF, SAFE_SRC, SCROLL_LERP_MAX, SCROLL_LERP_MIN, SLIDER_DEFAULTS, STYLE_SECTIONS, TOKEN_NAME_RE, TRANSITION_DEFAULTS, TRANSITION_PRESET_IDS, adoptStructure, alignInstanceLines, applyClass, buildDocument, cloneForMaster, compileAnimation, countLocaleSeo, createNode, createPage, createProject, dataMarkerOf, deepClone, defaultBreakpoints, defaultSettings, elementBlockLines, enforceDocument, expandComponentInstances, extractBodyArg, extractBodyDecor, extractBodyLines, findNode, findParent, fontError, fontFormatForUrl, hasAncestorOfType, hasNodeState, hasOpenArgBracket, hoistBlockRef, interactionGroupKey, interactionMarkerOf, interactionStateKey, isAllowedAttribute, isBodyOpenLine, isComponentType, isEmittableToken, isKnownElement, isLeafElement, isReservedToken, isRich, isStateClass, isSymmetricTrigger, isThemeValue, isValidClass, isValidToken, lexLine, matchClass, normalizeComponentName, normalizeSyntax, parseSetup, parseSyntax, purgeLocaleSeo, reconcile, refOf, replaceSetup, resolveSliderConfig, sameProperty, sanitizeAttributes, sanitizeRich, serializeNode, setSetupLocale, setStyleTokens, slugify, stripExtractedInstanceState, stripNodeState, styleMarkerOf, tokenError, typeOptionsFor, validateAnimation, validateBinding, validateDocument, validateMotionSettings, validateSliderConfig, walkNodes, withDataMarker, withInteractionMarker, withStyleMarker, withoutRef };
