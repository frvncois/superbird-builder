//#region src/lib/nodeState.ts
/**
* What a node carries beyond its structure.
*
* This is what is left of `syntax.ts` after the indentation DSL was deleted
* (TREE-SOURCE-PLAN.md, Phase 4). The list used to mean "the state the code
* cannot express, which `reconcile` therefore had to carry across a reparse";
* it now means "the state a write preserves on every element it adopts", which
* is the same list for the same reason — it is everything the agent format does
* not put in the markup.
*
* One definition, shared by the HTML writer's `fresh` path and by anything else
* that wants a clean slate. It had drifted when it was spelled out twice.
*/
var NODE_STATE_KEYS = [
	"classes",
	"content",
	"src",
	"svg",
	"hidden",
	"variants",
	"background",
	"htmlId",
	"attributes",
	"interactions",
	"animations",
	"locales",
	"listQuery",
	"entryId",
	"fieldAttrs",
	"instanceAttributes",
	"slider",
	"form"
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
/** drop everything a node carried, leaving its structure */
function stripNodeState(node) {
	for (const key of NODE_STATE_KEYS) delete node[key];
}
/**
* List sources that are not collections: `@pages` iterates the site's own
* published pages. The `@` prefix is reserved, so it can never collide with a
* collection someone named "pages".
*/
var BUILTIN_LIST_SOURCES = ["@pages"];
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
* Deep-clone a subtree into the master id space: fresh ids, and
* interaction/animation binding `targetId`s that point INSIDE the subtree
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
		delete n.svg;
		delete n.hidden;
		delete n.background;
		delete n.locales;
		delete n.content;
	});
}
/** component types are Capitalized; built-in elements stay lowercase */
function isComponentType(type) {
	return /^[A-Z]/.test(type);
}
/** a fresh mirror of a master subtree: its structure, none of its state */
function createMirror(master) {
	const node = {
		id: crypto.randomUUID(),
		type: master.type,
		content: "",
		children: master.children.map(createMirror)
	};
	if (master.arg) node.arg = master.arg;
	if (master.link) node.link = master.link;
	return node;
}
/** `arg` and `link` are CODE-OWNED: inside an instance they belong to the
*  master, so they are copied down rather than kept. */
function adoptCodeOwned(node, master, box) {
	if ((node.arg ?? void 0) !== (master.arg ?? void 0)) {
		if (master.arg) node.arg = master.arg;
		else delete node.arg;
		box.moved = true;
	}
	if ((node.link ?? void 0) !== (master.link ?? void 0)) {
		if (master.link) node.link = master.link;
		else delete node.link;
		box.moved = true;
	}
}
/**
* Reshape one level of children to the master's, KEEPING the node object for
* each child that survives — which is what carries everything the structure
* does not: the id, the per-instance text, media, translations, hidden flag and
* variant picks, and (on a page) the htmlId and comment anchors.
*
* Matched like `adoptStructure` matches — by code signature, LCS-aligned, then
* by type for whatever that left over — so inserting an icon in Button does not
* slide every Card's button text onto the wrong node.
*/
function alignLevel(node, master, box) {
	const old = node.children;
	const matches = lcsAlign$1(old.map(nodeSignature), master.children.map(nodeSignature));
	const used = new Set(matches.values());
	const freeOld = old.map((_, i) => i).filter((i) => !used.has(i));
	const freeNew = master.children.map((_, i) => i).filter((i) => !matches.has(i));
	if (freeOld.length && freeNew.length) {
		const weak = lcsAlign$1(freeOld.map((i) => old[i].type), freeNew.map((i) => master.children[i].type));
		for (const [nj, oj] of weak) matches.set(freeNew[nj], freeOld[oj]);
	}
	const next = master.children.map((child, i) => {
		const at = matches.get(i);
		const kept = at !== void 0 ? old[at] : createMirror(child);
		if (at === void 0) box.moved = true;
		adoptCodeOwned(kept, child, box);
		alignLevel(kept, child, box);
		return kept;
	});
	if (next.length !== old.length || next.some((child, i) => child !== old[i])) {
		node.children = next;
		box.moved = true;
	}
}
/**
* Bring an INSTANCE's subtree in step with the master it stands for, keeping
* every per-instance value on the nodes that survive. The node's OWN line is
* left alone — on a page that is a real page node, with its own ref, htmlId and
* classes; what is below it is the component's.
*
* Returns whether anything moved, so a caller can tell a real change from a
* push that found everything already current.
*/
function alignStructure(instance, master) {
	const box = { moved: false };
	alignLevel(instance, master, box);
	return box.moved;
}
/**
* The same, for a MIRROR a master holds: there the wrapper node is part of the
* host's own tree, so its code-owned slots follow the inner master too (a
* mirror that lacked them would not be structurally identical to it, which is
* the invariant the positional pairing relies on).
*/
function alignMirror(mirror, master) {
	const box = { moved: false };
	adoptCodeOwned(mirror, master, box);
	alignLevel(mirror, master, box);
	return box.moved;
}
/**
* Bring every mirror a host holds back in step with the component it mirrors.
* Returns whether anything changed.
*/
function alignHostMirrors(host, components) {
	let moved = false;
	const visit = (nodes) => {
		for (const node of nodes) {
			if (!isComponentType(node.type)) {
				visit(node.children);
				continue;
			}
			const inner = components.find((c) => c.name === node.type);
			if (inner && inner !== host && alignMirror(node, inner.root)) moved = true;
		}
	};
	visit(host.root.children);
	return moved;
}
/** every nested-instance wrapper a master holds directly (not the ones inside
*  a mirror, which belong to the component being mirrored) */
function nestedWrappers(def, name) {
	const out = [];
	const visit = (nodes) => {
		for (const node of nodes) if (!isComponentType(node.type)) visit(node.children);
		else if (!name || node.type === name) out.push(node);
	};
	visit(def.root.children);
	return out;
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
/** a node's SHALLOW identity: its type, its `[arg]` binding, its link.
* Deliberately NOT recursive: matching is done one
* level at a time (like the page reconciler matching by line), so a container
* keeps its identity even when its children change, while its children realign
* among themselves. Classes/content/interactions are excluded — they are the
* off-code state we're carrying across the edit. Two `:h2:@/a` and
* `:h2:@/b` get distinct signatures; two bare `:h2:` are genuinely
* indistinguishable (no algorithm can tell which identical sibling was
* removed — same irreducible case the reconciler faces). */
function nodeSignature(node) {
	return `${node.type}|${node.arg ?? ""}|${node.link ?? ""}`;
}
/** longest-common-subsequence alignment of two signature lists → a map from
* b-index to the a-index it matches. Same primitive the page reconciler uses,
* so component adoption and page edits carry identity the same way — a removed
* sibling no longer shifts the survivors onto the wrong master nodes. */
function lcsAlign$1(a, b) {
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
	const matches = lcsAlign$1(masterChildren.map(nodeSignature), editedChildren.map(nodeSignature));
	const weakSignature = (n) => `${n.type}|${n.arg ?? ""}`;
	const freeMaster = masterChildren.map((_, i) => i).filter((i) => ![...matches.values()].includes(i));
	const freeEdited = editedChildren.map((_, i) => i).filter((i) => !matches.has(i));
	if (freeMaster.length && freeEdited.length) {
		const weak = lcsAlign$1(freeMaster.map((i) => weakSignature(masterChildren[i])), freeEdited.map((i) => weakSignature(editedChildren[i])));
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
	icon: {
		tag: "svg",
		void: true
	},
	video: { tag: "video" },
	form: {
		tag: "form",
		suggest: "input"
	},
	/**
	* A form's SUCCESS and ERROR states: direct children of a `form`, rendered
	* only after a submission lands (or fails). Their own types rather than a
	* styled div with a magic class, following the `list-empty` precedent — so
	* an author styles them like any element, they translate like any content,
	* and a misplaced one is a diagnostic instead of silently never rendering.
	*/
	"form-success": {
		tag: "div",
		suggest: "text"
	},
	"form-error": {
		tag: "div",
		suggest: "text"
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
	/**
	* A list's EMPTY STATE: a direct child of a `:collection-list` (or a bound
	* `:slider`) that renders only when the list has no entries, and is never
	* repeated. Without it a filtered list that matched nothing rendered as a
	* blank gap, and the only workaround was to not filter.
	*/
	"list-empty": {
		tag: "div",
		suggest: "text"
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
/**
* Types an element can switch between (same structural shape per group).
*
* The pure aliases (`container`, `grid`, `heading`, `dropdown`) are absent:
* nothing can create one any more — the v2 migration collapsed every stored
* one, and the insert dock offers Container/Grid/Heading as PRESETS (a div or
* an h2 plus classes) rather than as types. They stay in the registry above
* purely so a blob the migration never saw still renders its real tag instead
* of degrading to a bare div; that can go one release after launch.
*/
var TYPE_GROUPS = [
	[
		"section",
		"div",
		"header",
		"footer",
		"article",
		"nav",
		"main",
		"aside",
		"list-item"
	],
	[
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
//#region src/lib/shared/tokens.js
var TOKEN_NAME_RE = /^[a-z][a-z0-9-]*$/;
var HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
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
var FONT_FAMILY_RE$1 = /^[A-Za-z0-9][A-Za-z0-9 -]*$/;
/** a weight the CSS accepts: 100–900, or a variable-font range ("100 900") */
var WEIGHT_RE$1 = /^(?:[1-9]00|normal|bold)(?: (?:[1-9]00))?$/;
/** only same-origin media paths and https URLs may be fetched as fonts —
*  mirrors SAFE_SRC's intent, minus the data:/mailto:/tel: cases that make no
*  sense for a font file */
var SAFE_FONT_SRC = /^(?:\/|https:\/\/)/i;
/** human-readable reason a font entry is unusable, or null when it is fine */
function fontError(font, others = []) {
	const family = String(font?.family ?? "").trim();
	if (!family) return "Family name required";
	if (!FONT_FAMILY_RE$1.test(family)) return "Letters, digits, spaces and hyphens only";
	if (others.some((f) => f !== font && String(f.family ?? "").trim().toLowerCase() === family.toLowerCase() && (f.weight ?? "400") === (font.weight ?? "400") && (f.style ?? "normal") === (font.style ?? "normal"))) return "Another font already uses this family, weight and style";
	if (!font?.src) return "Pick a font file";
	if (!SAFE_FONT_SRC.test(font.src)) return "Font files must be a /media/… path or an https:// URL";
	if (font.weight && !WEIGHT_RE$1.test(String(font.weight))) return "Weight is 100–900, or a range like \"100 900\"";
	return null;
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
			},
			apiOrigin: ""
		},
		seo: {
			siteName: "",
			titleTemplate: "%s",
			description: "",
			ogImage: void 0
		},
		domain: "",
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
/** a page's root: the `:body` wrap every document is built around */
function createBody(arg) {
	const body = createNode("body");
	if (arg) body.arg = arg;
	return body;
}
function createPage(name, path, _locale = "en") {
	const now = Date.now();
	return {
		id: crypto.randomUUID(),
		name,
		path,
		status: "published",
		elements: [createBody()],
		createdAt: now,
		updatedAt: now
	};
}
function createProject(name) {
	return {
		id: crypto.randomUUID(),
		name,
		schemaVersion: 2,
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
//#region src/lib/html/tags.ts
/**
* The element registry ↔ the agent-facing HTML subset.
*
* Agents read and write pages as HTML because it is a format every model
* already knows; the registry is what the app actually renders. This module is
* the one place the two are reconciled, in both directions.
*
* Tag names are CASE-SENSITIVE here. That is what lets `<Card>` mean a
* component instance, and it is why the parser is hand-rolled rather than
* parse5 or any other HTML5 parser: they all lowercase tag names.
*/
/** registry types whose HTML tag is not their own name */
var TAG_OF = {
	body: "body",
	paragraph: "p",
	link: "a",
	list: "ul",
	"list-item": "li",
	image: "img",
	icon: "svg",
	text: "div",
	checkbox: "input",
	radio: "input",
	"collection-list": "collection-list",
	"collection-item": "collection-item",
	"list-empty": "list-empty",
	slider: "slider",
	"form-success": "form-success",
	"form-error": "form-error"
};
/**
* Pure aliases: a type whose tag AND shape are another type's.
*
* They serialize as the target's tag, so reading one back has to resolve to
* the target — and `sameType` has to treat the pair as equal, or every write
* would re-mint the node for a difference that renders nowhere. The Phase 4
* migration collapses them in the stored data; until then this keeps the
* round-trip exact.
*/
var ALIAS_OF = {
	container: "div",
	grid: "div",
	heading: "h2",
	dropdown: "select"
};
/** the HTML tag a node of this type is written as */
function tagForType(type) {
	if (isComponentType(type)) return type;
	const canonical = ALIAS_OF[type] ?? type;
	return TAG_OF[canonical] ?? canonical;
}
/** the registry type a tag reads back as — the reverse of `tagForType`, with
*  each ambiguous tag resolved to its canonical type */
var TYPE_OF_TAG = (() => {
	const out = {};
	for (const type of Object.keys(ELEMENTS)) {
		if (ALIAS_OF[type]) continue;
		const tag = tagForType(type);
		if (out[tag] === void 0) out[tag] = type;
	}
	out.div = "div";
	out.input = "input";
	out.select = "select";
	return out;
})();
/** do these two types mean the same element? (an alias and its target do) */
function sameType(a, b) {
	if (a === b) return true;
	return (ALIAS_OF[a] ?? a) === (ALIAS_OF[b] ?? b);
}
/**
* Which element a tag means.
*
* `attrs` disambiguates the two tags that carry more than one type: `<input>`
* splits on its `type` (checkbox/radio are the registry's own types so an
* author never has to remember the attribute), and `<div data-type="text">` is
* the text block.
*
* `components` lets a lowercase `<card>` resolve to `Card` when exactly one
* component matches — models lowercase tag names out of habit, and refusing
* the whole write over it would be the format's most common papercut.
*/
function typeForTag(tag, attrs, components) {
	if (isComponentType(tag)) return { type: tag };
	if (tag === "input") {
		const kind = attrs.type;
		if (kind === "checkbox" || kind === "radio") return { type: kind };
		return { type: "input" };
	}
	if (tag === "div" && attrs["data-type"] === "text") return { type: "text" };
	const known = TYPE_OF_TAG[tag];
	if (known) return { type: known };
	const matches = components.filter((name) => name.toLowerCase() === tag.toLowerCase());
	if (matches.length === 1) return {
		type: matches[0],
		note: `<${tag}> read as the component <${matches[0]}> — component tags are capitalized`
	};
	return null;
}
/**
* Void tags that may be written without the self-closing slash.
*
* Matched CASE-SENSITIVELY, and never against a component: a component called
* `Input` or `Link` is not `<input>`, and lowercasing the tag first made
* `<Input>` a void element, so its closing tag read as a mismatch and its
* children landed on whatever contained it.
*/
var VOID_TAGS = /* @__PURE__ */ new Set([
	"img",
	"input",
	"br",
	"hr",
	"meta",
	"link",
	"source"
]);
var isLenientVoidTag = (tag) => !isComponentType(tag) && VOID_TAGS.has(tag);
/** tags that are never content, whatever they claim to be */
var FORBIDDEN_TAGS = /* @__PURE__ */ new Set([
	"script",
	"style",
	"iframe",
	"object",
	"embed",
	"base"
]);
/** does this element carry text rather than children? Registry-driven. */
var isLeafType = (type) => !isComponentType(type) && isLeafElement(type);
/** is this a type the app can render at all? */
var isRenderableType = (type) => isComponentType(type) || isKnownElement(type);
/**
* `source` carries the collection an element iterates or embeds; `data-field`
* carries an ordinary element's field binding. Both land on `node.arg` — two
* names because they read as two different things, and an agent that confuses
* them is told so rather than silently binding the wrong way.
*/
var SOURCE_TYPES = /* @__PURE__ */ new Set([
	"collection-list",
	"collection-item",
	"slider",
	"body"
]);
/**
* The attributes an element type IMPLIES — `checkbox` is `<input type="checkbox">`.
*
* They are part of the element's identity, not state: the registry carries
* them, every renderer emits them, and the reader uses them to pick the type
* back out of the tag. So the writer emits them and the reader consumes them,
* rather than storing them as custom attributes (which would make the type and
* the attribute two places to disagree).
*/
var impliedAttrs = (type) => !isComponentType(type) && ELEMENTS[type]?.attrs || {};
//#endregion
//#region src/lib/legacy/dsl.ts
/**
* LEGACY: the indentation DSL's parser, kept for ONE purpose.
*
* Until the v2 schema migration, a page carried both a tree (`elements`) and
* the DSL text it was derived from (`code`). The tree is what every renderer
* read, so the tree is what the migration keeps — re-deriving from the text
* would be a chance to change the published site, and over the corpus it
* demonstrably did (one fixture page carries a `link` its line never had).
*
* What is left is the SALVAGE case: a stored page with code but no usable
* tree. That should not exist — the editor kept the two in sync for as long as
* both existed — but "should not exist" is not a thing to bet a one-way
* migration on, so the parser stays until a release has passed with no
* salvage logged. Nothing else may import this.
*
* Reduced to what salvage needs: no `adopt` callback (there is no previous
* tree to carry identity from), no reconcile, no validation, no markers.
*/
var REF = "(?:#(?<ref>[a-zA-Z][a-zA-Z0-9-]?[a-zA-Z0-9-]*)?)?";
var NAME = "[a-zA-Z][a-zA-Z0-9-]*";
var ARG = "(?:\\[(?<arg>[a-z0-9.@+-]*)\\]?)?";
var MARKERS = "(?:\\(\\+?\\)?)?(?:\\{\\+?\\}?)?";
var LINK = "(?:@(?<link>\\S+))?";
var LEAF = new RegExp(`^:(?<name>${NAME})${REF}${ARG}${MARKERS}:${LINK}$`);
var OPEN = new RegExp(`^:(?<name>${NAME})${REF}${ARG}${MARKERS}${LINK}$`);
var CLOSE = /^([a-zA-Z][a-zA-Z0-9-]*):$/;
var slots = (m) => {
	const g = m.groups;
	return {
		name: g.name,
		ref: g.ref,
		arg: g.arg,
		link: g.link
	};
};
/** splits a line into its tokens, including glued ones (`:div:h1:`) */
function lexLine(text) {
	const tokens = [];
	let i = 0;
	while (i < text.length) {
		let j = i;
		if (text[j] === ":") {
			j++;
			while (j < text.length && /[a-zA-Z0-9-]/.test(text[j])) j++;
			if (text[j] === "#") {
				j++;
				while (j < text.length && /[a-zA-Z0-9-]/.test(text[j])) j++;
			}
			if (text[j] === "[") {
				j++;
				while (j < text.length && text[j] !== "]") j++;
				if (text[j] === "]") j++;
			}
			while (text[j] === "(" || text[j] === "{" || text[j] === "+" || text[j] === ")" || text[j] === "}") j++;
			if (text[j] === ":") {
				const next = text[j + 1];
				if (!next || !/[a-zA-Z]/.test(next)) j++;
				else if (text.slice(j).match(/^:[a-zA-Z][a-zA-Z0-9-]*[:[(@{]/)) {} else j++;
			}
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
/** Parse a stored page document into a tree. Salvage only. */
function parseLegacyCode(code) {
	const root = [];
	const stack = [];
	const append = (node) => {
		const parent = stack[stack.length - 1];
		(parent ? parent.children : root).push(node);
	};
	const make = (name, m) => {
		const { ref, arg, link } = slots(m);
		const node = createNode(name);
		if (arg && arg !== "+") node.arg = arg;
		if (ref) node.ref = ref;
		if (link) node.link = link === "item" ? "@item" : link;
		return node;
	};
	for (const line of code.split("\n")) for (const token of lexLine(line.trim())) {
		const leaf = token.match(LEAF);
		if (leaf) {
			const { name } = slots(leaf);
			if (isKnownElement(name) || isComponentType(name)) append(make(name, leaf));
			continue;
		}
		const open = token.match(OPEN);
		if (open) {
			const { name } = slots(open);
			if (isKnownElement(name) || isComponentType(name)) {
				const node = make(name, open);
				append(node);
				stack.push(node);
			}
			continue;
		}
		const close = token.match(CLOSE);
		if (close) {
			for (let i = stack.length - 1; i >= 0; i--) if (stack[i].type === close[1]) {
				stack.length = i;
				break;
			}
		}
	}
	return root;
}
//#endregion
//#region src/lib/migrate.ts
/**
* The v2 schema: the tree is the only source of truth.
*
* v1 carried the indentation DSL beside it — `page.code`, plus a `line` and
* `endLine` on every node — because the text was authoritative for structure.
* Nothing reads any of it now (TREE-SOURCE-PLAN.md, Phases 1 and 3), so v2
* drops it, and with it the pure alias types the DSL's registry carried.
*
* This runs ONCE per blob, on the server at boot, over every project blob in
* the store: the drafts, Main, the `guano-base:*` merge snapshots (which are
* whole project copies, so a 3-way merge against an unmigrated base would see
* every page as changed) and the published baseline. It is also applied
* client-side as a defensive no-op and to anything `/api/project-import`
* brings in.
*
* It is IDEMPOTENT: a project already at v2 is returned untouched, which is
* what makes "run it on everything, every boot" safe.
*/
var SCHEMA_VERSION = 2;
var emptyReport = () => ({
	changed: false,
	from: 1,
	pages: 0,
	collapsed: {},
	materialized: 0,
	salvaged: [],
	textDisagreed: []
});
/**
* Migrate a project in place. Returns the same object, plus a report.
*
* Pass `pageToCode` to have the migration compare each page's stored text
* against the text its tree implies and record the pages that disagree. That
* is the only reason it would ever want the old serializer, so the caller
* supplies it rather than this module importing a thing it is deleting.
*/
function migrateProject(project, opts = {}) {
	const report = emptyReport();
	if (!project || !Array.isArray(project.pages)) return {
		project,
		report
	};
	report.from = project.schemaVersion ?? 1;
	if (report.from >= 2) return {
		project,
		report
	};
	const components = project.components ?? [];
	const byName = /* @__PURE__ */ new Map();
	for (const def of components) if (!byName.has(def.name)) byName.set(def.name, def);
	const collapse = (node) => {
		const target = ALIAS_OF[node.type];
		if (!target) return;
		report.collapsed[node.type] = (report.collapsed[node.type] ?? 0) + 1;
		node.type = target;
	};
	const dropDsl = (node) => {
		collapse(node);
		delete node.line;
		delete node.endLine;
	};
	/** an instance that was never materialized (a stored `:Card:` leaf) has no
	*  nodes at all — nothing ever expanded it, so it rendered as nothing */
	const materialize = (node) => {
		if (!isComponentType(node.type) || node.children.length) return;
		const def = byName.get(node.type);
		if (!def?.root.children.length) return;
		alignStructure(node, def.root);
		report.materialized++;
	};
	for (const page of project.pages) {
		report.pages++;
		let body = (page.elements ?? []).find((n) => n.type === "body");
		if (!body) {
			body = (page.code ? parseLegacyCode(page.code) : []).find((n) => n.type === "body");
			if (body) {
				page.elements = [body];
				report.salvaged.push(page.name || page.id);
			} else {
				body = createBody();
				page.elements = [body];
				report.salvaged.push(`${page.name || page.id} (empty)`);
			}
		} else if (page.elements.length > 1) page.elements = [body];
		if (opts.pageToCode && page.code) {
			if (opts.pageToCode(page, project.defaultLocale || "en") !== page.code) report.textDisagreed.push(page.name || page.id);
		}
		walkNodes([body], materialize);
		walkNodes([body], dropDsl);
		delete page.code;
	}
	for (const def of components) walkNodes([def.root], dropDsl);
	project.schemaVersion = 2;
	report.changed = true;
	return {
		project,
		report
	};
}
/** a one-line summary for a boot log */
function describeMigration(key, report) {
	if (!report.changed) return null;
	const bits = [`${report.pages} page${report.pages === 1 ? "" : "s"}`];
	const collapsed = Object.entries(report.collapsed);
	if (collapsed.length) bits.push(`collapsed ${collapsed.map(([t, n]) => `${n}×${t}`).join(", ")}`);
	if (report.materialized) bits.push(`materialized ${report.materialized} instance(s)`);
	if (report.textDisagreed.length) bits.push(`${report.textDisagreed.length} page(s) whose stored DSL disagreed with the tree (the tree wins)`);
	if (report.salvaged.length) bits.push(`SALVAGED from DSL: ${report.salvaged.join(", ")}`);
	return `${key}: v${report.from} → v2 — ${bits.join("; ")}`;
}
//#endregion
//#region src/lib/shared/instances.js
/** component types are Capitalized in the syntax; built-ins stay lowercase */
var isComponentType$1 = (type) => /^[A-Z]/.test(type);
/**
* @typedef {object} Mapping
* @property {object} master      the master node this page node stands for —
*                                where its classes, interactions and structure live
* @property {object} root        the root of that master's component
* @property {object} def         the component itself
* @property {string} instanceId  the id of the instance wrapper this node sits
*                                in: what makes a binding's state unique per instance
* @property {object[]} mirrors   nodes between this one and its master that may
*                                also carry its state, most specific first (the
*                                copies held by the components it is nested in)
* @property {Record<string,string>} picks  the instance's variant option per axis
*/
/**
* Map every node that lives in a component instance to its master, by
* structural position (index + type): the instance block on the page mirrors
* the master's tree, so the n-th child stands for the master's n-th child.
*
* COMPONENTS NEST. A master's tree may hold a node typed as another component
* — a nested instance, whose subtree there is a MIRROR: the inner component's
* structure, carrying only what this host says about it (its text, its picks,
* its hidden parts). So a page node inside `Card > Button` stands for a node
* of BUTTON's master — that is where its classes and interactions live — and
* the Card master's mirror of it sits in between, as the first place to look
* for anything the page node does not set itself.
*
* `roots` are the trees to walk — a page's elements, or (on the components
* board) each master's own children. `components` is the project's list; a
* name resolves to the FIRST component carrying it, as `findComponent` does.
*
* @returns {Map<string, Mapping>}
*/
function buildInstanceMap(roots, components) {
	const byName = /* @__PURE__ */ new Map();
	for (const def of components ?? []) if (!byName.has(def.name)) byName.set(def.name, def);
	const map = /* @__PURE__ */ new Map();
	const walk = (inst, master, mirrors, scope) => {
		if (inst.type !== master.type) return;
		map.set(inst.id, {
			master,
			root: scope.def.root,
			def: scope.def,
			instanceId: scope.instanceId,
			mirrors,
			picks: scope.picks
		});
		const length = Math.min(inst.children.length, master.children.length);
		for (let i = 0; i < length; i++) {
			const child = inst.children[i];
			const below = master.children[i];
			const childMirrors = mirrors.map((mirror) => mirror.children?.[i]).filter((mirror) => mirror && mirror.type === child.type);
			const inner = isComponentType$1(below.type) ? byName.get(below.type) : void 0;
			if (inner && inner !== scope.def && child.type === below.type) instance(child, inner, [...childMirrors, below]);
			else walk(child, below, childMirrors, scope);
		}
	};
	const instance = (wrapper, def, mirrors) => {
		walk(wrapper, def.root, mirrors, {
			def,
			instanceId: wrapper.id,
			picks: resolvePicks(def, wrapper, mirrors)
		});
	};
	const visit = (nodes) => {
		for (const node of nodes ?? []) {
			const def = isComponentType$1(node.type) ? byName.get(node.type) : void 0;
			if (def) instance(node, def, []);
			else visit(node.children);
		}
	};
	visit(roots);
	return map;
}
/** is this mapped node the `:Name` wrapper of its instance, rather than
* something inside it? */
var isInstanceWrapper = (mapping) => !!mapping && mapping.master === mapping.root;
/**
* The components a component's master holds, directly — by name, each once.
*/
function nestedComponentNames(def) {
	const names = /* @__PURE__ */ new Set();
	const visit = (nodes) => {
		for (const node of nodes ?? []) if (isComponentType$1(node.type)) names.add(node.type);
		else visit(node.children);
	};
	visit(def.root.children);
	return [...names];
}
/** can `from` reach `to` by following what each component holds? */
function componentReaches(components, from, to) {
	const byName = /* @__PURE__ */ new Map();
	for (const def of components ?? []) if (!byName.has(def.name)) byName.set(def.name, def);
	const seen = /* @__PURE__ */ new Set();
	const visit = (name) => {
		if (name === to) return true;
		if (seen.has(name)) return false;
		seen.add(name);
		const def = byName.get(name);
		return !!def && nestedComponentNames(def).some(visit);
	};
	return visit(from);
}
/**
* May an instance of `inner` be placed inside `host`'s master? Not when that
* would make a component hold itself, at any distance: `Card` in `Card`, or
* `Card` in a `Button` that a `Card` already holds.
*/
function canNest(components, host, inner) {
	return host !== inner && !componentReaches(components, inner, host);
}
/**
* The components ordered so that each comes AFTER everything it holds. Work
* that flows outward from a change — an inner component's new structure, then
* the hosts that mirror it — has to run in this order.
*/
function dependencyOrder(components) {
	const byName = /* @__PURE__ */ new Map();
	for (const def of components ?? []) if (!byName.has(def.name)) byName.set(def.name, def);
	const out = [];
	const state = /* @__PURE__ */ new Map();
	const visit = (def) => {
		if (state.has(def.name)) return;
		state.set(def.name, "open");
		for (const name of nestedComponentNames(def)) {
			const inner = byName.get(name);
			if (inner) visit(inner);
		}
		state.set(def.name, "done");
		out.push(def);
	};
	for (const def of components ?? []) visit(def);
	for (const def of components ?? []) if (!out.includes(def)) out.push(def);
	return out;
}
/**
* The option an instance picks on each of its component's axes: its wrapper's
* own pick, else one from the components it is nested in, else the axis
* default. A pick naming an option that no longer exists falls through —
* a stale name must never leave an instance wearing nothing.
*/
function resolvePicks(def, wrapper, mirrors) {
	const picks = {};
	for (const axis of def.variants ?? []) {
		let pick;
		for (const source of [wrapper, ...mirrors ?? []]) {
			const value = source?.variants?.[axis.name];
			if (value !== void 0 && axis.options.includes(value)) {
				pick = value;
				break;
			}
		}
		picks[axis.name] = pick ?? axis.default;
	}
	return picks;
}
/**
* The first DEFINED value of `key` along a node's chain: its own, then each
* mirror's, then its master's. `undefined` when nothing in the chain sets it.
*
* "Defined", not "truthy": `hidden: false` on an instance is how it shows a
* part its component hides by default.
*/
function resolveInstanceValue(node, mapping, key) {
	if (node[key] !== void 0) return node[key];
	if (!mapping) return void 0;
	for (const mirror of mapping.mirrors) if (mirror[key] !== void 0) return mirror[key];
	return mapping.master[key];
}
/** what a node would inherit for `key` if it set nothing itself */
function inheritedInstanceValue(mapping, key) {
	if (!mapping) return void 0;
	for (const mirror of mapping.mirrors) if (mirror[key] !== void 0) return mirror[key];
	return mapping.master[key];
}
/** a hidden node is not rendered and not exported — for this instance only,
* when the flag is its own */
function isNodeHidden(node, mapping) {
	return resolveInstanceValue(node, mapping, "hidden") === true;
}
/**
* Show or hide a node, writing only what differs from what it inherits — so
* hiding a part and showing it again leaves the node byte-identical, which
* keeps merge signatures (whole-object JSON) from reporting a change that
* was undone.
*/
function setNodeHidden(node, mapping, hidden) {
	if (hidden === (inheritedInstanceValue(mapping, "hidden") === true)) delete node.hidden;
	else node.hidden = hidden;
}
//#endregion
//#region src/lib/instances.ts
var buildInstanceMap$1 = buildInstanceMap;
/** is this mapped node the `:Name` wrapper of its instance? */
var isInstanceWrapper$1 = isInstanceWrapper;
/** the components a component's master holds directly, by name */
var nestedComponentNames$1 = nestedComponentNames;
/** may an instance of `inner` sit inside `host`'s master? Never in a cycle. */
var canNest$1 = canNest;
/** each component after everything it holds */
var dependencyOrder$1 = dependencyOrder;
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
var WEIGHT_RE = /^(?:[1-9]\d{0,2}|1000)$/;
/** whether free-form text is a valid arbitrary value for a named-scale format */
function matchesNamedFormat(format, text) {
	switch (format) {
		case "length": return LEN_RE.test(text);
		case "line-height": return /^\d*\.?\d+$/.test(text) || LEN_RE.test(text);
		case "tracking": return TRACK_RE.test(text);
		case "weight": return WEIGHT_RE.test(text);
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
var slide$1 = (prefix, stops = SPACING) => ({
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
				control: slide$1("gap")
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
				control: slide$1("grid-rows", [
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
				control: slide$1("top"),
				relevance: positioned
			},
			{
				id: "right",
				label: "Right",
				control: slide$1("right"),
				relevance: positioned
			},
			{
				id: "bottom",
				label: "Bottom",
				control: slide$1("bottom"),
				relevance: positioned
			},
			{
				id: "left",
				label: "Left",
				control: slide$1("left"),
				relevance: positioned
			},
			{
				id: "z-index",
				label: "Z-index",
				control: slide$1("z", [
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
			control: slide$1("p")
		}, {
			id: "margin",
			label: "Margin",
			control: slide$1("m")
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
				control: slide$1("opacity", OPACITY),
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
				control: slide$1("duration", [
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
				control: slide$1("delay", [
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
				control: slide$1("scale", [
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
	for (const prefix of [
		"top",
		"right",
		"bottom",
		"left",
		"inset",
		"inset-x",
		"inset-y"
	]) for (const value of [
		"full",
		"1/2",
		"1/3",
		"2/3",
		"1/4",
		"3/4"
	]) {
		out.add(`${prefix}-${value}`);
		out.add(`-${prefix}-${value}`);
	}
	for (const n of [
		"1",
		"2",
		"3",
		"4",
		"5",
		"6",
		"none"
	]) out.add(`line-clamp-${n}`);
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
		"contents",
		"flow-root",
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
	propForBaseCache.clear();
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
var FONT_FAMILY_RE = /^font-(?:sans|serif|mono)$/;
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
/** colour families an opacity modifier is meaningful on. `/50` on anything else
* is either a fraction (`w-1/2`, handled by SPACING_FRACTION_RE) or nonsense, so
* the stem is only re-checked for these. */
var OPACITY_MODIFIER_RE = /^((?:bg|text|border|ring|outline|divide|shadow|from|via|to|decoration|caret|accent|placeholder|fill|stroke)-.+)\/(?:\d{1,3}|\[[^\]]+\])$/;
function isValidClass(cls) {
	const { variants: segments, base } = splitClassVariants(cls);
	if (!base) return false;
	if (segments.some((v) => !isKnownVariant(v))) return false;
	if (/-\[.+\]$/.test(base)) return true;
	const opacity = OPACITY_MODIFIER_RE.exec(base);
	if (opacity) return isValidClass(opacity[1]);
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
/** Offsets are one group per side, like SIZE_FAMILIES — the catalog lists only
* the numeric stops, so `top-full` used to stack onto `top-0` and the winner was
* whichever Tailwind emitted last. The value shape is checked rather than the
* prefix alone, or v4's `inset-ring-*` / `inset-shadow-*` would be read as
* offsets. Longest prefix first, so `inset-x-0` is not an `inset`. */
var OFFSET_FAMILIES = [
	"inset-x",
	"inset-y",
	"inset",
	"top",
	"right",
	"bottom",
	"left"
];
var OFFSET_VALUE_RE = /^(?:\d+(?:\.\d+)?|\d+\/\d+|full|auto|px|\[[^\]]+\])$/;
function offsetFamily(base) {
	const bare = base.startsWith("-") ? base.slice(1) : base;
	for (const family of OFFSET_FAMILIES) {
		if (!bare.startsWith(`${family}-`)) continue;
		const value = bare.slice(family.length + 1);
		return OFFSET_VALUE_RE.test(value) ? `offset:${family}` : void 0;
	}
}
/** the catalog property a bare class belongs to, if any.
*
* Memoized: this scans the whole catalog, and `mergeClassLayers` asks it for
* every class of every element carrying variant overrides — on a canvas
* rendering a few thousand Buttons across three frames that was the second
* largest cost of opening a page. The answer depends only on the class and
* the token vocabulary, so `setStyleTokens` is what clears it. */
var propForBaseCache = /* @__PURE__ */ new Map();
function propForBase(base) {
	if (propForBaseCache.has(base)) return propForBaseCache.get(base);
	let found;
	outer: for (const section of STYLE_SECTIONS) for (const prop of section.properties) if (matchClass(prop, [base]) === base) {
		found = prop;
		break outer;
	}
	propForBaseCache.set(base, found);
	return found;
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
	const offset = offsetFamily(base);
	if (offset) return offset;
	if (base === "truncate" || base.startsWith("line-clamp-")) return "line-clamp";
	if (BG_POSITION_RE.test(base) || base.startsWith("bg-position-")) return "background-position";
	if (base.startsWith("bg-") && !NON_COLOR_BG_RE.test(base)) return "background-color";
	if (FONT_FAMILY_RE.test(base) || FONT_ARBITRARY_FAMILY_RE.test(base)) return "font-family";
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
/**
* What `prefix-…` means when it is NOT a colour, per prefix that doubles as
* one. Defined by the non-colours because those are a closed set, while a
* colour is a palette name, a project token, a keyword or an arbitrary value —
* and a project's tokens are not known to every caller of this module.
*/
var NOT_A_PAINT = {
	text: /^(?:xs|sm|base|lg|xl|\dxl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|\[[\d.].*\])$/,
	border: /^(?:\d+|[xytrblse](?:-\d+)?|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing-.*|\[[\d.].*\])$/,
	ring: /^(?:\d+|inset|offset-.*|\[[\d.].*\])$/,
	outline: /^(?:\d+|none|hidden|solid|dashed|dotted|double|offset-.*|\[[\d.].*\])$/,
	decoration: /^(?:\d+|auto|from-font|solid|double|dotted|dashed|wavy|slice|clone)$/,
	divide: /^(?:[xy](?:-\d+|-reverse)?|solid|dashed|dotted|double|none)$/,
	stroke: /^(?:\d+|\[[\d.].*\])$/,
	fill: /^$/,
	accent: /^$/,
	caret: /^$/
};
/** `text:paint` for a colour class on a prefix that doubles as one, else undefined */
function paintFamily(base) {
	const dash = base.indexOf("-");
	if (dash === -1) return void 0;
	const prefix = base.slice(0, dash);
	const not = NOT_A_PAINT[prefix];
	if (!not || not.test(base.slice(dash + 1))) return void 0;
	return `${prefix}:paint`;
}
/** sides and modes that are part of a utility's NAME, not its value: `border-t`
* is a different property from `border`, where `border-2` is the same one */
var NAME_TAILS = /* @__PURE__ */ new Set([
	"x",
	"y",
	"t",
	"r",
	"b",
	"l",
	"s",
	"e",
	"inset",
	"reverse"
]);
/** a class minus its value: `px-4` → `px`, `underline-offset-2` →
* `underline-offset`, `-mt-4` → `mt`, `border-t` → `border-t` */
function headOf(base) {
	const bare = base.startsWith("-") ? base.slice(1) : base;
	if (/^flex-(?:no)?wrap/.test(bare)) return "flex-wrap";
	const bracket = bare.endsWith("]") ? bare.lastIndexOf("-[") : -1;
	const at = bracket !== -1 ? bracket : bare.lastIndexOf("-");
	if (at <= 0) return bare;
	return NAME_TAILS.has(bare.slice(at + 1)) ? bare : bare.slice(0, at);
}
/**
* Do two bare classes set the same property, for the purpose of LAYERING one
* class string over another?
*
* Wider than `sameProperty`, which answers from the style catalog and so has
* no answer for what the catalog does not list — side spacing (`px-4`), rings,
* outlines, token colours on `text-`. There that is harmless: a class it
* cannot place is simply added. Here a missed conflict leaves `px-4 px-3` on
* one element, and which of the two wins is decided by stylesheet order.
*
* So: colours first (by prefix), then the catalog where it knows BOTH classes,
* then the class's own name.
*/
function sameLayerProperty(a, b) {
	if (a === b) return true;
	const pa = paintFamily(a);
	const pb = paintFamily(b);
	if (pa || pb) return pa === pb;
	const ka = propKey(a);
	const kb = propKey(b);
	if (ka !== void 0 && kb !== void 0) return ka === kb;
	return headOf(a) === headOf(b);
}
/**
* Layer class strings, later wins per property: `mergeClassLayers('h-9 px-4
* bg-primary', 'h-8 px-3')` is `bg-primary h-8 px-3`.
*
* A base class an override replaces is REMOVED, not left beside it. Two
* Tailwind classes on one property do not resolve by their order in the class
* attribute but by their order in the stylesheet — so `h-9 h-8` is whichever
* Tailwind happened to emit last, which is not a thing to build variants on.
*
* Conflicts are per variant, like everywhere else here: `hover:bg-accent` does
* not evict `bg-primary`. NOT the published runtime's heuristic
* (shared/interactionClasses.js), which cannot tell `rounded-lg` from
* `rounded-md` or `text-sm` from `text-xs` — exactly what a size axis changes.
*/
function mergeClassLayers(base, ...layers) {
	let tokens = base.split(/\s+/).filter(Boolean);
	for (const layer of layers) for (const cls of (layer ?? "").split(/\s+/).filter(Boolean)) {
		const { variant, base: bare } = splitVariant(cls);
		tokens = tokens.filter((t) => {
			const s = splitVariant(t);
			return !(s.variant === variant && sameLayerProperty(s.base, bare));
		});
		tokens.push(cls);
	}
	return tokens.join(" ");
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
//#region src/lib/variants.ts
/**
* Variants — how one component's instances differ in look.
*
* A component declares axes (`variant`, `size`); each master node may carry
* class overrides per option (`node.variantClasses['size:sm']`); an instance
* picks one option per axis (`node.variants` on its wrapper). What an element
* wears is its base classes with the picked options layered on, in axis order.
*
* Which options an instance picks is resolved with the rest of its chain, in
* `shared/instances.js`. This module is the other half — turning picks into a
* class string — and lives in TS because it needs the full style catalog. It
* is bundled into the MCP runtime, which is also where the exporter gets it.
*/
/** the key an option's overrides are stored under on a master node */
var variantKey = (axis, option) => `${axis}:${option}`;
/** the name rule for an axis or an option: what reads well in a key and a select */
var VARIANT_NAME_RE = /^[a-z][a-z0-9-]*$/;
/** the option `picks` selects on each of a component's axes, defaults filled in */
function pickedKeys(def, picks) {
	return (def?.variants ?? []).map((axis) => variantKey(axis.name, axis.options.includes(picks[axis.name] ?? "") ? picks[axis.name] : axis.default));
}
/**
* The classes a master node wears for an instance with these picks. A node
* with no overrides — most of them — costs nothing.
*/
function effectiveClasses(node, def, picks) {
	const base = node.classes ?? "";
	const overrides = node.variantClasses;
	if (!overrides || !def?.variants?.length) return base;
	return mergeClassLayers(base, ...pickedKeys(def, picks).map((key) => overrides[key]));
}
//#endregion
//#region src/lib/componentOps.ts
/**
* Whole-project operations on components — rename, duplicate, categorize,
* detach, delete.
*
* These live here rather than in `useComponents` because every one of them
* spans ALL pages, while the composable's `masterMap` / `detachComponent` are
* bound to the active page. Editing ONE tree — a master, or a page — is
* `lib/treeOps`; this is what the rest of the project then has to be told.
* `pushMasterStructure` and the detach verbs are re-exported into the committed
* MCP runtime bundle, so the agent path runs this code rather than a copy of
* it: rebuild the bundle (`npm run build:mcp-runtime`) after changing them.
*
* All of it is pure: a `Project` in, mutations out, no Vue. That is what makes
* it testable headlessly.
*/
/**
* The ONE writer of the optional keys, so their JSON key order is the same
* everywhere. `computeMerge` compares whole-object `JSON.stringify`, which is
* key-order sensitive: a def built `{id,name,category,root}` and one built
* `{id,name,root,category}` are equal in every way that matters and would
* still read as a conflict. Deleting them all and re-adding them puts them
* last, in one order, always.
*
* `meta` is the WHOLE set: a key left out is a key removed. Pass what the def
* already has for the ones that are not changing.
*/
function setComponentMeta(def, meta) {
	delete def.category;
	delete def.source;
	delete def.variants;
	const category = meta.category?.trim();
	if (category) def.category = category;
	if (meta.source) def.source = meta.source;
	if (meta.variants?.length) def.variants = meta.variants.map((axis) => ({
		name: axis.name,
		options: [...axis.options],
		default: axis.default
	}));
}
/** where a component is actually used — the number the delete confirm quotes */
function componentUsage(project, name) {
	let count = 0;
	const pages = [];
	for (const page of project.pages) {
		let onPage = 0;
		walkNodes(page.elements, (n) => {
			if (n.type === name) onPage++;
		});
		if (!onPage) continue;
		count += onPage;
		pages.push({
			id: page.id,
			name: page.name
		});
	}
	const hosts = project.components.filter((c) => c.name !== name && nestedComponentNames$1(c).includes(name)).map((c) => c.name);
	return {
		count,
		pages,
		hosts
	};
}
/**
* Renames a component, every instance of it, and every mirror of it.
*
* Returns the name actually used (normalized and de-duplicated), or null when
* the id doesn't resolve.
*/
function renameComponent(project, id, rawName) {
	const def = project.components.find((c) => c.id === id);
	if (!def) return null;
	const name = normalizeComponentName(rawName, project.components.filter((c) => c.id !== id).map((c) => c.name));
	if (name === def.name) return name;
	const old = def.name;
	def.name = name;
	def.root.type = name;
	for (const host of project.components) walkNodes(host.root.children, (node) => {
		if (node.type === old) node.type = name;
	});
	for (const page of project.pages) walkNodes(page.elements, (node) => {
		if (node.type !== old) return;
		node.type = name;
	});
	return name;
}
/** An independent copy under a new name. Creates no instances. */
function duplicateComponent(project, id) {
	const def = project.components.find((c) => c.id === id);
	if (!def) return null;
	const name = normalizeComponentName(`${def.name}Copy`, project.components.map((c) => c.name));
	const { cloned } = cloneForMaster(def.root);
	cloned.type = name;
	const copy = {
		id: crypto.randomUUID(),
		name,
		root: cloned
	};
	setComponentMeta(copy, {
		category: def.category,
		variants: def.variants
	});
	project.components.push(copy);
	return copy;
}
function setComponentCategory(project, id, category) {
	const def = project.components.find((c) => c.id === id);
	if (!def) return false;
	setComponentMeta(def, {
		category,
		source: def.source,
		variants: def.variants
	});
	return true;
}
/** what a host says about a nested instance — the state a mirror carries */
var MIRROR_KEYS = [
	"content",
	"src",
	"svg",
	"background",
	"locales",
	"hidden",
	"variants"
];
/** `node` takes, for each key it does not set itself, the first mirror's value */
function inheritFromMirrors(node, mirrors) {
	for (const key of MIRROR_KEYS) {
		if (node[key] !== void 0 && node[key] !== "") continue;
		const from = mirrors.find((m) => m[key] !== void 0 && m[key] !== "");
		if (from) node[key] = deepClone(from[key]);
	}
}
/**
* One instance's nodes with their masters — the shared pairing
* (lib/instances), over any page rather than only the active one, plus the
* master → instance direction a detach needs to retarget bindings.
*
* Only the nodes that belong to THIS component are paired. An instance nested
* inside it stays an instance when its host is detached, so its nodes are not
* baked — they only take over what the host's master said about them, which
* is about to stop being reachable.
*/
function pairWithMaster(instance, def, components) {
	const pairs = [];
	const masterToInstance = /* @__PURE__ */ new Map();
	const map = buildInstanceMap$1([instance], [def, ...components.filter((c) => c !== def)]);
	walkNodes([instance], (node) => {
		const mapping = map.get(node.id);
		if (!mapping) return;
		if (mapping.def !== def) {
			inheritFromMirrors(node, mapping.mirrors);
			return;
		}
		pairs.push({
			node,
			master: mapping.master,
			classes: effectiveClasses(mapping.master, mapping.def, mapping.picks)
		});
		masterToInstance.set(mapping.master.id, node.id);
	});
	return {
		pairs,
		masterToInstance
	};
}
/** Copies the master's shared state onto the page nodes that were inheriting it. */
function bakeMasterState(pairs, masterToInstance) {
	const retarget = (targetId) => targetId ? masterToInstance.get(targetId) ?? targetId : null;
	for (const { node, master, classes } of pairs) {
		if (classes) node.classes = classes;
		delete node.variants;
		if (master.attributes) node.attributes = deepClone(master.attributes);
		if (master.interactions?.length) node.interactions = master.interactions.map((b) => ({
			...deepClone(b),
			id: crypto.randomUUID(),
			targetId: retarget(b.targetId)
		}));
		if (master.animations?.length) node.animations = master.animations.map((b) => ({
			...deepClone(b),
			id: crypto.randomUUID(),
			targetId: retarget(b.targetId)
		}));
		if (!node.content && master.content) node.content = master.content;
		if (!node.src && master.src) node.src = master.src;
		if (!node.svg && master.svg) node.svg = master.svg;
		if (node.hidden === void 0 && master.hidden) node.hidden = true;
		else if (node.hidden === false) delete node.hidden;
		if (!node.background && master.background) node.background = master.background;
		if (!node.locales && master.locales) node.locales = deepClone(master.locales);
	}
}
/**
* The exporter's own test (`server/export.mjs`, renderNode): a `:Name` wrapper
* with nothing of its own emits NO element at all — its children render
* inline. Such a wrapper has to be UNWRAPPED on detach, not retyped: a `:div`
* in its place would add a box the published page never had, and with it
* whatever `space-y-*` / `divide-*` / `first:` rules the real parent applies
* to its children.
*/
function isBareWrapper(root) {
	return !root.classes?.trim() && !root.background && !root.interactions?.length;
}
/** Detaches one instance. */
function detachOne(page, def, instanceId, components) {
	const instance = findNode(page.elements, instanceId);
	if (!instance || instance.type !== def.name) return false;
	const parent = findParent(page.elements, instanceId);
	if (!parent) return false;
	if (!instance.children.length && def.root.children.length) alignStructure(instance, def.root);
	const { pairs, masterToInstance } = pairWithMaster(instance, def, components);
	bakeMasterState(pairs, masterToInstance);
	if (!isBareWrapper(def.root)) {
		instance.type = "div";
		return true;
	}
	const at = parent.children.indexOf(instance);
	const first = instance.children[0];
	if (first) {
		if (instance.ref && !first.ref) first.ref = instance.ref;
		if (instance.htmlId && !first.htmlId) first.htmlId = instance.htmlId;
	}
	parent.children.splice(at, 1, ...instance.children);
	return true;
}
/**
* Turns every instance of a component, on every page, back into plain
* elements that look exactly the same. Returns how many were detached.
*/
function detachComponentInstances(project, def) {
	let detached = 0;
	for (const page of project.pages) {
		const ids = [];
		walkNodes(page.elements, (n) => {
			if (n.type === def.name) ids.push(n.id);
		});
		if (!ids.length) continue;
		for (const id of ids) if (detachOne(page, def, id, project.components)) detached++;
	}
	return detached;
}
/** Detaches a single instance — the canvas context menu's "Detach". */
function detachInstance(project, page, instanceId) {
	const node = findNode(page.elements, instanceId);
	const def = node ? project.components.find((c) => c.name === node.type) : null;
	if (!def) return false;
	if (!detachOne(page, def, instanceId, project.components)) return false;
	return true;
}
/**
* Pushes a master's current structure out to every instance of it, on every
* page. Returns how many instance subtrees it had to move.
*
* Realigning (rather than rebuilding) is what carries per-instance state
* across: every node that survives the match IS the same node object, so its
* id, text, media, translations, hidden flag, variant picks and htmlId come
* with it, and a subtree that was already in step comes out byte-identical. A
* push that found everything current therefore reads as no edit at all.
*
* "Every instance" includes the ones NESTED in other components: the mirrors
* those components hold in their own masters are brought back in step first —
* inner components before the hosts that mirror them — and the blocks on the
* pages follow at any depth.
*
* An instance that was never materialized (a `:Card:` leaf in stored code) is
* simply one whose children do not match yet, so it is filled in here with no
* special case.
*/
function pushMasterStructure(project, def) {
	if (!project.components.some((c) => c.id === def.id)) return 0;
	alignMirrors(project.components);
	let moved = 0;
	for (const page of project.pages) {
		const instances = [];
		walkNodes(page.elements, (n) => {
			if (n.type === def.name) instances.push(n);
		});
		if (!instances.length) continue;
		for (const node of instances) if (alignStructure(node, def.root)) moved++;
	}
	return moved;
}
/**
* Bring every mirror in step with the component it mirrors, inner components
* first so a host two levels up mirrors an already-current structure.
*/
function alignMirrors(components) {
	for (const host of dependencyOrder$1(components)) alignHostMirrors(host, components);
}
/**
* Deletes a component, detaching every instance first so no page loses its
* content. Interactions and design tokens the component used stay in the
* project — they are shared libraries, and the detached elements still use
* them.
*/
function deleteComponent(project, id) {
	const def = project.components.find((c) => c.id === id);
	if (!def) return false;
	for (const host of dependencyOrder$1(project.components)) {
		if (host === def) continue;
		const held = nestedWrappers(host, def.name);
		if (!held.length) continue;
		for (const wrapper of held) detachInMaster(host, wrapper, def);
		pushMasterStructure(project, host);
	}
	detachComponentInstances(project, def);
	project.components = project.components.filter((c) => c.id !== id);
	return true;
}
/**
* Turns one nested instance, in a host's MASTER, into plain elements that look
* the same: the inner component's structure and look, with what the host said
* about it on top. The tree-form twin of `detachOne`, same bare-wrapper rule.
*/
function detachInMaster(host, wrapper, inner) {
	const parent = findParent([host.root], wrapper.id);
	if (!parent) return;
	const picks = resolvePicks(inner, wrapper, []);
	const { cloned } = cloneForMaster(inner.root);
	const bake = (node, master, mirror, held) => {
		if (!held) {
			const classes = effectiveClasses(master, inner, picks);
			if (classes) node.classes = classes;
			else delete node.classes;
			delete node.variantClasses;
		}
		if (mirror) inheritFromMirrors(clearForOverlay(node, mirror), [mirror]);
		if (node.hidden === false) delete node.hidden;
		node.children.forEach((child, i) => {
			const below = master.children[i];
			if (!below) return;
			bake(child, below, mirror?.children[i], held || isComponentType(child.type));
		});
	};
	bake(cloned, inner.root, wrapper, false);
	delete cloned.variants;
	const bare = !cloned.classes?.trim() && !cloned.background && !cloned.interactions?.length;
	const at = parent.children.indexOf(wrapper);
	if (bare) parent.children.splice(at, 1, ...cloned.children);
	else parent.children.splice(at, 1, {
		...cloned,
		type: "div"
	});
}
/** what the mirror sets wins over what the clone inherited from the master */
function clearForOverlay(node, mirror) {
	for (const key of MIRROR_KEYS) if (mirror[key] !== void 0 && mirror[key] !== "") delete node[key];
	return node;
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
var escapeText$2 = (s) => s.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
var escapeAttr$1 = (s) => s.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;");
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
			out.push(escapeText$2(token));
			continue;
		}
		const match = token.match(/^<(\/?)([a-zA-Z0-9]+)([^>]*)>$/);
		if (!match) {
			out.push(escapeText$2(token));
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
			out.push(safe ? `<a href="${escapeAttr$1(safe)}" rel="noopener">` : "<a>");
		} else out.push(`<${tag}>`);
		open.push(tag);
	}
	for (let i = open.length - 1; i >= 0; i--) out.push(`</${open[i]}>`);
	return out.join("");
}
//#endregion
//#region src/lib/html/ids.ts
/**
* Short `data-id`s.
*
* A node id is a uuid. Printing 36 characters on every element of a 9,000-node
* page costs an agent more context than the markup does, and the id only has
* to be unique within the ONE document the agent is looking at. So the read
* emits an 8-hex prefix, lengthened only where two ids collide, and the write
* resolves a prefix back.
*
* It is the strongest adoption signal there is: an agent that echoes back the
* ids it read keeps every node's identity — its interactions, its
* translations, its comment anchors — whatever else it rewrites.
*/
var BASE = 8;
/** node id → the shortest unique prefix, per tree */
function shortIds(roots) {
	const ids = [];
	walkNodes(roots, (n) => ids.push(n.id));
	const out = /* @__PURE__ */ new Map();
	const taken = /* @__PURE__ */ new Set();
	for (const id of ids) {
		const flat = id.replace(/-/g, "");
		let length = Math.min(BASE, flat.length);
		let short = flat.slice(0, length);
		while (taken.has(short) && length < flat.length) short = flat.slice(0, ++length);
		if (taken.has(short)) continue;
		taken.add(short);
		out.set(id, short);
	}
	return out;
}
/** the inverse: a short id (or a full uuid) → the node it addresses */
function nodesByShortId(roots) {
	const out = /* @__PURE__ */ new Map();
	const shorts = shortIds(roots);
	walkNodes(roots, (n) => {
		const short = shorts.get(n.id);
		if (short) out.set(short, n);
		out.set(n.id, n);
		out.set(n.id.replace(/-/g, ""), n);
	});
	return out;
}
//#endregion
//#region src/lib/html/serialize.ts
var INDENT = "  ";
var escapeText$1 = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** a `data:` URL is megabytes of base64 nobody can read or edit — the read
*  shows that it is one, and a write preserves whatever the node already had */
var ELIDED_DATA_URL = "data:…(elided)";
var showSrc = (src) => src.startsWith("data:") ? ELIDED_DATA_URL : src;
/** the attributes one node writes, in canonical order */
function attrsFor(node, ctx, inInstance) {
	const mapping = ctx.map.get(node.id);
	const shared = inInstance || !!mapping && isInstanceWrapper$1(mapping);
	const out = [];
	const short = ctx.shorts.get(node.id);
	if (ctx.ids && short) out.push(["data-id", short]);
	if (node.ref) out.push(["data-ref", node.ref]);
	if (!shared && ctx.mode === "full" && node.classes?.trim()) out.push(["class", node.classes.trim()]);
	const rest = [];
	for (const [name, value] of Object.entries(impliedAttrs(node.type))) rest.push([name, value]);
	if (node.htmlId) rest.push(["id", node.htmlId]);
	if (node.arg) rest.push([SOURCE_TYPES.has(node.type) ? "source" : "data-field", node.arg]);
	if (node.link) rest.push(["href", node.link]);
	if (node.src) rest.push(["src", showSrc(node.src)]);
	if (node.type === "icon") rest.push(["data-icon", iconName(node)]);
	if (node.type === "text") rest.push(["data-type", "text"]);
	if (node.hidden !== void 0) rest.push(["data-hidden", String(node.hidden)]);
	const implied = impliedAttrs(node.type);
	for (const [name, value] of Object.entries(node.attributes ?? {})) if (!shared && implied[name] === void 0) rest.push([name, value]);
	for (const [attr, field] of Object.entries(node.fieldAttrs ?? {})) rest.push([`data-bind-${attr}`, field]);
	for (const [axis, option] of Object.entries(node.variants ?? {})) rest.push([`data-variant-${axis}`, option]);
	if (ctx.mode === "full" && ctx.effects) {
		const effects = ctx.effectNames(node);
		if (effects.interactions.length) rest.push(["data-interactions", effects.interactions.join(", ")]);
		if (effects.animations.length) rest.push(["data-animations", effects.animations.join(", ")]);
	}
	rest.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
	return [...out, ...rest].map(([name, value]) => value === true ? ` ${name}` : ` ${name}="${escapeAttr(String(value))}"`);
}
/** which bundled icon a node's svg is, or `custom` for hand-written markup */
var iconName = (node) => node.svg?.match(/data-icon="([a-z0-9:_-]+)"/)?.[1] ?? (node.svg ? "custom" : "");
function emit(node, depth, ctx, inInstance, out) {
	const pad = INDENT.repeat(depth);
	const tag = tagForType(node.type);
	const attrs = attrsFor(node, ctx, inInstance).join("");
	const isInstance = isComponentType(node.type) && node.id !== ctx.masterRootId;
	if (isLeafType(node.type)) {
		const text = ctx.mode === "full" ? node.content ?? "" : "";
		if (!text) {
			out.push(`${pad}<${tag}${attrs} />`);
			return;
		}
		out.push(`${pad}<${tag}${attrs}>${isRich(text) ? text : escapeText$1(text)}</${tag}>`);
		return;
	}
	if (!node.children.length) {
		out.push(`${pad}<${tag}${attrs} />`);
		return;
	}
	out.push(`${pad}<${tag}${attrs}>`);
	for (const child of node.children) emit(child, depth + 1, ctx, inInstance || isInstance, out);
	out.push(`${pad}</${tag}>`);
}
function contextFor(project, roots, mapRoots, opts) {
	const components = project.components ?? [];
	const byId = /* @__PURE__ */ new Map();
	for (const effect of project.interactions ?? []) byId.set(effect.id, effect.name);
	for (const anim of project.animations ?? []) byId.set(anim.id, anim.name);
	const map = buildInstanceMap$1(mapRoots, components);
	return {
		mode: opts.mode ?? "full",
		ids: opts.ids !== false,
		effects: opts.effects !== false,
		shorts: shortIds(roots),
		map,
		components,
		effectNames: (node) => {
			const mapping = map.get(node.id);
			const owner = mapping && !isInstanceWrapper$1(mapping) ? mapping.master : node;
			return {
				interactions: (owner.interactions ?? []).map((b) => byId.get(b.interactionId) ?? "?"),
				animations: (owner.animations ?? []).map((b) => byId.get(b.animationId) ?? "?")
			};
		}
	};
}
/** one page's body as HTML */
function pageToHtml(page, project, opts = {}) {
	const body = page.elements.find((n) => n.type === "body");
	if (!body) return "<body />";
	const ctx = contextFor(project, page.elements, page.elements, opts);
	const root = opts.subtree ? resolveSubtree(page.elements, opts.subtree, ctx) : body;
	if (!root) return "";
	const out = [];
	const mapping = ctx.map.get(root.id);
	emit(root, 0, ctx, !!mapping && !isInstanceWrapper$1(mapping), out);
	return out.join("\n");
}
/** a component master as HTML — its root element IS the component */
function masterToHtml(def, project, opts = {}) {
	const ctx = {
		...contextFor(project, [def.root], def.root.children, opts),
		masterRootId: def.root.id
	};
	const out = [];
	emit(def.root, 0, ctx, false, out);
	return out.join("\n");
}
function resolveSubtree(roots, key, ctx) {
	for (const [id, short] of ctx.shorts) if (short === key) return findNode(roots, id);
	const byId = findNode(roots, key);
	if (byId) return byId;
	let byRef = null;
	const visit = (nodes) => {
		for (const node of nodes) {
			if (byRef) return;
			if (node.ref === key) byRef = node;
			else visit(node.children);
		}
	};
	visit(roots);
	return byRef;
}
//#endregion
//#region src/lib/html/parse.ts
var MAX_INPUT = 2e6;
var MAX_DEPTH = 64;
var MAX_ERRORS = 20;
var TAG_NAME = /^[A-Za-z][A-Za-z0-9-]*/;
var ATTR_NAME = /^[A-Za-z_:][A-Za-z0-9_:.-]*/;
function parseHtml(input, components = []) {
	const errors = [];
	const notes = [];
	const roots = [];
	if (input.length > 2e6) return {
		roots,
		errors: [{
			message: `input is ${input.length} bytes; the limit is ${MAX_INPUT}. Write one subtree at a time (edit_structure) rather than the whole page.`,
			line: 1,
			col: 1
		}],
		notes
	};
	const lineStarts = [0];
	for (let k = 0; k < input.length; k++) if (input[k] === "\n") lineStarts.push(k + 1);
	const at = (offset) => {
		let lo = 0;
		let hi = lineStarts.length - 1;
		while (lo < hi) {
			const mid = lo + hi + 1 >> 1;
			if (lineStarts[mid] <= offset) lo = mid;
			else hi = mid - 1;
		}
		return {
			line: lo + 1,
			col: offset - lineStarts[lo] + 1
		};
	};
	const fail = (offset, message) => {
		if (errors.length >= MAX_ERRORS) return;
		errors.push({
			message,
			...at(offset)
		});
	};
	const stack = [];
	const push = (node) => {
		const parent = stack[stack.length - 1];
		if (parent) parent.children.push(node);
		else roots.push(node);
	};
	let i = 0;
	while (i < input.length && errors.length < MAX_ERRORS) {
		const lt = input.indexOf("<", i);
		if (lt === -1) {
			reportStrayText(input.slice(i), i);
			break;
		}
		if (lt > i) reportStrayText(input.slice(i, lt), i);
		i = lt;
		if (input.startsWith("<!--", i)) {
			const end = input.indexOf("-->", i + 4);
			if (end === -1) return bail(i, "unterminated comment");
			i = end + 3;
			continue;
		}
		if (input.startsWith("<!", i)) {
			const end = input.indexOf(">", i);
			if (end === -1) return bail(i, "unterminated declaration");
			i = end + 1;
			continue;
		}
		if (input[i + 1] === "/") {
			const match = TAG_NAME.exec(input.slice(i + 2));
			const end = input.indexOf(">", i);
			if (!match || end === -1) return bail(i, "malformed closing tag");
			const tag = match[0];
			const open = stack[stack.length - 1];
			if (!open) {
				fail(i, `</${tag}> closes nothing`);
				i = end + 1;
				continue;
			}
			if (open.tag !== tag) return bail(i, `</${tag}> does not close <${open.tag}>, opened on line ${open.line}`);
			stack.pop();
			i = end + 1;
			continue;
		}
		const start = i;
		const nameMatch = TAG_NAME.exec(input.slice(i + 1));
		if (!nameMatch) return bail(i, "'<' does not start a tag — write a literal one as &lt;");
		const tag = nameMatch[0];
		i += 1 + tag.length;
		const head = readAttrs(tag, start);
		if (!head) return {
			roots,
			errors,
			notes
		};
		const { attrs, selfClosed } = head;
		i = head.after;
		if (FORBIDDEN_TAGS.has(tag.toLowerCase())) {
			fail(start, `<${tag}> is never allowed; script and style belong in the project's custom code`);
			continue;
		}
		const resolved = typeForTag(tag, attrs, components);
		if (!resolved || !isRenderableType(resolved.type)) {
			fail(start, `unknown element <${tag}>`);
			continue;
		}
		if (resolved.note && !notes.includes(resolved.note)) notes.push(resolved.note);
		const node = {
			type: resolved.type,
			tag,
			attrs,
			children: [],
			...at(start)
		};
		if (stack.length >= 64) return bail(start, `nesting deeper than 64 elements`);
		push(node);
		if (selfClosed || isLenientVoidTag(tag)) continue;
		if (node.type === "div") {
			const nextTag = input.indexOf("<", i);
			if ((nextTag === -1 ? input.slice(i) : input.slice(i, nextTag)).trim() && input.startsWith(`</${tag}`, nextTag)) node.type = "text";
		}
		if (isLeafType(node.type)) {
			const end = input.indexOf(`</${tag}`, i);
			if (end === -1) return bail(start, `<${tag}> is never closed`);
			node.text = input.slice(i, end);
			const gt = input.indexOf(">", end);
			i = gt === -1 ? input.length : gt + 1;
			continue;
		}
		stack.push(node);
	}
	for (const open of stack) {
		if (errors.length >= MAX_ERRORS) break;
		errors.push({
			message: `<${open.tag}> is never closed`,
			line: open.line,
			col: open.col
		});
	}
	return {
		roots,
		errors,
		notes
	};
	/** a structural error leaves the rest of the input meaningless: stop, so the
	*  report is the one real problem rather than its echoes */
	function bail(offset, message) {
		fail(offset, message);
		return {
			roots,
			errors,
			notes
		};
	}
	/** text outside an element: whitespace is layout, anything else would render
	*  nowhere */
	function reportStrayText(text, offset) {
		if (!text.trim()) return;
		const parent = stack[stack.length - 1];
		const quoted = text.trim().slice(0, 40);
		fail(offset + (text.length - text.trimStart().length), parent ? `"${quoted}" sits directly inside <${parent.tag}>, which is a container. Put text in a text element: <p>, <span>, <h2>, or <div data-type="text">.` : `"${quoted}" is outside any element`);
	}
	function readAttrs(tag, tagStart) {
		const attrs = {};
		let k = i;
		for (;;) {
			while (k < input.length && /\s/.test(input[k])) k++;
			if (k >= input.length) {
				fail(tagStart, `<${tag}> is not closed with '>'`);
				return null;
			}
			if (input[k] === ">") return {
				attrs,
				selfClosed: false,
				after: k + 1
			};
			if (input[k] === "/" && input[k + 1] === ">") return {
				attrs,
				selfClosed: true,
				after: k + 2
			};
			const nameMatch = ATTR_NAME.exec(input.slice(k));
			if (!nameMatch) {
				fail(k, `<${tag}>: '${input[k]}' does not start an attribute name`);
				return null;
			}
			const name = nameMatch[0].toLowerCase();
			const nameAt = k;
			k += nameMatch[0].length;
			if (name.startsWith("on")) {
				fail(nameAt, `<${tag}>: '${name}' event handlers are never allowed`);
				return null;
			}
			if (name in attrs) {
				fail(nameAt, `<${tag}>: '${name}' is written twice`);
				return null;
			}
			while (k < input.length && /\s/.test(input[k])) k++;
			if (input[k] !== "=") {
				attrs[name] = "";
				continue;
			}
			k++;
			while (k < input.length && /\s/.test(input[k])) k++;
			const quote = input[k];
			if (quote !== "\"" && quote !== "'") {
				fail(k, `<${tag}>: the value of '${name}' must be quoted`);
				return null;
			}
			const end = input.indexOf(quote, k + 1);
			if (end === -1) {
				fail(k, `<${tag}>: the value of '${name}' is not closed`);
				return null;
			}
			attrs[name] = decodeEntities(input.slice(k + 1, end));
			k = end + 1;
		}
	}
}
/** the five XML entities plus numeric ones — what a model writes, and all this
*  format promises to understand */
function decodeEntities(text) {
	return text.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10))).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
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
/**
* Attributes whose value is TEXT A VISITOR READS, and so can be translated.
* `type`, `role` and `name` are structural and never localized; these four are
* copy, and on a multilingual site they used to render in the default language
* on every locale route with no way to change it.
*/
var LOCALIZABLE_ATTRS = [
	"placeholder",
	"aria-label",
	"alt",
	"title"
];
/** true when `name` carries text worth translating */
function isLocalizableAttribute(name) {
	return LOCALIZABLE_ATTRS.includes(String(name).toLowerCase().trim());
}
/**
* The attributes an element renders: the component master's, with this
* placement's own overrides on top, then the active locale's text overrides.
*
* Shared by both Vue renderers and the exporter so the canvas, Preview and the
* published page agree. `localeAttrs` is already narrowed to the locale being
* rendered (absent on the default locale).
*/
function mergeAttributeLayers(shared, instance, localeAttrs) {
	const out = { ...shared ?? {} };
	for (const [name, value] of Object.entries(instance ?? {})) out[name] = value;
	for (const [name, value] of Object.entries(localeAttrs ?? {})) if (isLocalizableAttribute(name) && String(value) !== "") out[name] = value;
	return out;
}
//#endregion
//#region src/lib/validateTree.ts
function validateTree(root, ctx) {
	const diags = [];
	/** every ref seen so far → the node that claimed it */
	const refAt = /* @__PURE__ */ new Map();
	const visit = (node, parent, scopes, instances, forms) => {
		if (node.ref) {
			if (refAt.has(node.ref)) diags.push({
				nodeId: node.id,
				message: `'#${node.ref}' is already used by another element — refs must be unique on a page`
			});
			else refAt.set(node.ref, node);
			const host = instances[instances.length - 1];
			if (host) diags.push({
				nodeId: node.id,
				message: `'#${node.ref}' is inside the '${host}' component — refs are page-scope, and a component's structure is copied into every instance. Put the ref on the '${host}' element instead.`
			});
		}
		if (node.type === "list-empty") {
			if (!(!!parent && (parent.type === "collection-list" || parent.type === "slider" && !!parent.arg))) diags.push({
				nodeId: node.id,
				message: "'list-empty' is a list's empty state — it only renders as a DIRECT child of a 'collection-list' or a bound 'slider'. Elsewhere it never renders at all."
			});
		}
		if (node.type === "form-success" || node.type === "form-error") {
			if (parent?.type !== "form") diags.push({
				nodeId: node.id,
				message: `'${node.type}' is a form's ${node.type === "form-success" ? "success" : "error"} state — it only renders as a DIRECT child of a 'form'. Elsewhere it never renders at all.`
			});
			else {
				const twins = (parent.children ?? []).filter((c) => c.type === node.type);
				if (twins.length > 1 && twins[0] !== node) diags.push({
					nodeId: node.id,
					message: `this form already has a '${node.type}' — only the first one renders.`
				});
			}
		}
		if (node.type === "form" && forms.length) diags.push({
			nodeId: node.id,
			message: "a form cannot contain another form — browsers close the outer one, so the inner fields are not submitted."
		});
		if (node.link === "@item") {
			const scope = [...scopes].reverse().find((s) => s.arg && ctx.collectionNames.includes(s.arg));
			if (scope && ctx.dataOnlyCollections.includes(scope.arg)) diags.push({
				nodeId: node.id,
				message: `'@item' links to an entry's own page, but the collection '${scope.arg}' has no detail routes (detailRoutes: false). Remove the link, or give the collection a template page.`
			});
		}
		let childScopes = scopes;
		let childInstances = instances;
		if (isComponentType(node.type)) {
			if (!ctx.componentNames.includes(node.type)) diags.push({
				nodeId: node.id,
				message: `Unknown component '${node.type}'`
			});
			else {
				if (instances.includes(node.type)) diags.push({
					nodeId: node.id,
					message: `'${node.type}' can't contain itself`
				});
				childInstances = [...instances, node.type];
			}
		} else if (node.type === "collection-list" || node.type === "collection-item") {
			const arg = node.arg;
			if (!(!!arg && (ctx.collectionNames.includes(arg) || node.type === "collection-list" && BUILTIN_LIST_SOURCES.includes(arg) || node.type === "collection-list" && ctx.listFieldNames.includes(arg)))) diags.push({
				nodeId: node.id,
				message: `Unknown collection '${node.type}${arg ? `[${arg}]` : ""}'`
			});
			childScopes = [...scopes, {
				type: node.type,
				arg
			}];
		} else if (node.type === "slider") {
			const arg = node.arg;
			if (arg && !ctx.collectionNames.includes(arg) && !BUILTIN_LIST_SOURCES.includes(arg) && !ctx.listFieldNames.includes(arg)) diags.push({
				nodeId: node.id,
				message: `Unknown collection 'slider[${arg}]'`
			});
			if (arg) childScopes = [...scopes, {
				type: node.type,
				arg
			}];
		} else if (node.type === "body" && node.arg) childScopes = [...scopes, {
			type: node.type,
			arg: node.arg
		}];
		const childForms = node.type === "form" ? [...forms, node] : forms;
		for (const child of node.children) visit(child, node, childScopes, childInstances, childForms);
	};
	visit(root, null, [], [], []);
	return diags;
}
//#endregion
//#region src/lib/treeOps.ts
var pageHost = (body) => ({
	root: body,
	def: null
});
var masterHost = (def) => ({
	root: def.root,
	def
});
/**
* The same, by id.
*
* An HTML write can move a node OUT of a subtree it is removing, so "every id
* under the removed roots" is the wrong set there — what went is exactly the
* ids the document had and no longer has.
*/
function clearBindingsToIds(host, gone) {
	if (!gone.size) return;
	walkNodes([host.root], (n) => {
		if (n.interactions?.length) {
			n.interactions = n.interactions.filter((b) => !b.targetId || !gone.has(b.targetId));
			if (!n.interactions.length) delete n.interactions;
		}
		if (n.animations?.length) {
			n.animations = n.animations.filter((b) => !b.targetId || !gone.has(b.targetId));
			if (!n.animations.length) delete n.animations;
		}
	});
}
//#endregion
//#region src/lib/html/apply.ts
/**
* Attribute names an agent reaches for instead of `source` / `data-field`.
*
* `data-*` is otherwise authorable, so without this a plausible near miss
* lands as a custom DOM attribute and binds NOTHING, reported as success. The
* only clue was a downstream "Unknown collection" diagnostic on a list, and on
* a leaf there was none at all.
*/
var NEAR_MISS_BINDINGS = /* @__PURE__ */ new Set([
	"data-source",
	"data-collection",
	"data-list",
	"collection",
	"field",
	"data-bind"
]);
/** a node's shallow identity for the LCS: what its own tag encodes */
var signature = (node) => `${node.type}|${node.arg ?? ""}|${node.link ?? ""}`;
var parsedSignature = (node) => `${node.type}|${argOf(node) ?? ""}|${node.attrs.href ?? ""}`;
function argOf(node) {
	return (SOURCE_TYPES.has(node.type) ? node.attrs.source : node.attrs["data-field"]) || void 0;
}
/**
* Longest-common-subsequence alignment of two signature lists → a map from
* b-index to the a-index it matches. The same primitive the component adoption
* and the instance realign use, so identity is carried the same way
* everywhere: a removed sibling no longer shifts the survivors onto each
* other's nodes.
*/
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
/**
* Apply a parsed document to an existing root.
*
* `parsed` is either the root element itself (a `<body>`, or a component's own
* tag) or just its children — the root element is optional on input, because
* an agent writing a page body naturally writes the elements and nothing
* around them. Written out, the root's own attributes are applied too; left
* out, they are left alone.
*/
function applyHtml(root, parsed, opts) {
	const result = {
		kept: 0,
		created: 0,
		removed: 0,
		refused: [],
		warnings: [],
		diagnostics: []
	};
	const project = opts.project;
	const components = project.components ?? [];
	const host = opts.def ? masterHost(opts.def) : pageHost(root);
	let topAttrs = null;
	let children = parsed;
	if (parsed.length === 1 && sameType(parsed[0].type, root.type)) {
		topAttrs = parsed[0].attrs;
		children = parsed[0].children;
	}
	const before = /* @__PURE__ */ new Set();
	walkNodes([root], (n) => before.add(n.id));
	const mapped = buildInstanceMap$1([root], opts.def ? [opts.def, ...components.filter((c) => c !== opts.def)] : components);
	const refuse = (path, message) => result.refused.push({
		path,
		message
	});
	const warn = (path, message) => result.warnings.push({
		path,
		message
	});
	/** a readable address for a refusal: the element, with its ref when it has one */
	const name = (node) => node.ref ? `${node.type}#${node.ref}` : node.type;
	const under = (parent, node) => `${parent} > ${name(node)}`;
	const addressable = [root];
	walkNodes([root], (n) => {
		const mapping = mapped.get(n.id);
		if (!mapping || isInstanceWrapper$1(mapping)) addressable.push(n);
	});
	const byKey = nodesByShortId([root]);
	for (const [key, node] of [...byKey]) if (!addressable.includes(node)) byKey.delete(key);
	const byRef = /* @__PURE__ */ new Map();
	for (const node of addressable) if (node.ref) byRef.set(node.ref, node);
	const claim = /* @__PURE__ */ new Map();
	const claimed = /* @__PURE__ */ new Set();
	const eachParsed = (nodes, visit) => {
		for (const node of nodes) {
			visit(node);
			eachParsed(node.children, visit);
		}
	};
	for (const pass of ["data-id", "data-ref"]) eachParsed(children, (node) => {
		if (claim.has(node)) return;
		const key = node.attrs[pass];
		if (!key) return;
		const found = pass === "data-id" ? byKey.get(key) : byRef.get(key);
		if (!found || claimed.has(found) || !sameType(found.type, node.type)) return;
		claim.set(node, found);
		claimed.add(found);
	});
	if (topAttrs) applyState(root, {
		...bare(root.type),
		attrs: topAttrs
	}, root.type);
	alignLevel(root, children, name(root));
	const after = /* @__PURE__ */ new Set();
	walkNodes([root], (n) => after.add(n.id));
	const gone = /* @__PURE__ */ new Set();
	for (const id of before) if (!after.has(id)) gone.add(id);
	result.removed = gone.size;
	clearBindingsToIds(host, gone);
	result.diagnostics = validateTree(root, opts.validate ?? contextFromProject(project));
	return result;
	function bare(type) {
		return {
			type,
			tag: type,
			attrs: {},
			children: [],
			line: 0,
			col: 0
		};
	}
	/**
	* Pair this level's parsed children with the existing ones, then recurse.
	*
	* The claims are already in; what is left is aligned by an LCS on the
	* shallow signature (type, binding, link), then by type alone for whatever
	* that left over. Anything still unpaired is new.
	*/
	function alignLevel(parent, parsedChildren, path) {
		const freeOld = parent.children.map((node, i) => ({
			node,
			i
		})).filter(({ node }) => !claimed.has(node));
		const freeNew = parsedChildren.map((node, i) => ({
			node,
			i
		})).filter(({ node }) => !claim.has(node));
		for (const signatures of [() => [freeOld.map(({ node }) => signature(node)), freeNew.map(({ node }) => parsedSignature(node))], () => [freeOld.map(({ node }) => node.type), freeNew.map(({ node }) => node.type)]]) {
			const [a, b] = signatures();
			for (const [nj, oj] of lcsAlign(a, b)) {
				const target = freeNew[nj];
				const source = freeOld[oj];
				if (!target || !source) continue;
				if (claim.has(target.node) || claimed.has(source.node)) continue;
				if (!sameType(source.node.type, target.node.type)) continue;
				claim.set(target.node, source.node);
				claimed.add(source.node);
			}
		}
		const next = [];
		for (const child of parsedChildren) {
			let adopted = claim.get(child);
			if (adopted && (adopted === parent || !!findNode([adopted], parent.id))) {
				refuse(`${path} > ${name(adopted)}`, `<${child.tag}> is written inside its own subtree; it is kept where it was and a new element is created here`);
				claim.delete(child);
				adopted = void 0;
			}
			const node = adopted ?? createNode(child.type);
			if (adopted) result.kept++;
			else {
				result.created++;
				claim.set(child, node);
				claimed.add(node);
			}
			const childPath = under(path, node);
			applyState(node, child, child.type, childPath);
			if (isComponentType(node.type)) fillInstance(node, child, childPath);
			else if (!isLeafType(node.type)) alignLevel(node, child.children, childPath);
			next.push(node);
		}
		parent.children = next;
	}
	/**
	* A component instance.
	*
	* Self-closed (`<Card />`) means "this instance, as the component defines
	* it": the subtree is realigned to the master, which fills a fresh instance
	* and leaves an existing one's per-instance content exactly as it was.
	*
	* Written out (`<Card>…</Card>`) fills its PARTS: the structure has to match
	* the master, and only content, media and `alt` are taken. That is what
	* makes a page of eight filled-in Cards ONE write. Classes or a different
	* element inside are refused by name, because every renderer reads a mapped
	* node's classes from the master — one written here would render nowhere
	* while the write reported success.
	*/
	function fillInstance(node, parsed, path) {
		const def = components.find((c) => c.name === node.type);
		if (!def) return;
		if (opts.def && !canNest$1(components, opts.def.name, def.name)) {
			refuse(path, `<${def.name}> can't go inside <${opts.def.name}>: a component can't hold itself`);
			return;
		}
		alignStructure(node, def.root);
		if (!parsed.children.length) return;
		const fill = (instance, master, written, at) => {
			if (written.length !== master.length) {
				refuse(at, `<${def.name}> has ${master.length} part${master.length === 1 ? "" : "s"} here and ${written.length} ${written.length === 1 ? "was" : "were"} written. Write <${def.name} /> to leave its parts alone, or change the component itself with update_component.`);
				return;
			}
			written.forEach((child, i) => {
				const target = instance[i];
				const below = master[i];
				if (!target || !below) return;
				const childPath = under(at, target);
				if (!sameType(target.type, child.type)) {
					refuse(childPath, `part ${i + 1} of <${def.name}> is a <${target.type}>, not a <${child.tag}>`);
					return;
				}
				fillPart(target, child, def.name, childPath);
				fill(target.children, below.children, child.children, childPath);
			});
		};
		fill(node.children, def.root.children, parsed.children, path);
	}
	/**
	* One part of an instance.
	*
	* What an instance owns is its CONTENT, its media, its per-placement `alt`,
	* its hidden flag, its field-bound attributes and its `htmlId` — a per-page
	* anchor. Everything else on a mapped node (its classes, its binding, its
	* link, its shared attributes) is the master's: every renderer reads those
	* from there, so one written here would render nowhere. Writing back what
	* the read showed is therefore a no-op, and CHANGING it is refused with the
	* tool that can actually do it.
	*/
	function fillPart(node, parsed, component, path) {
		const shared = (attr, current) => {
			if ((parsed.attrs[attr] ?? "") === (current ?? "")) return;
			refuse(path, `'${attr}' inside <${component}> is the component's, not this instance's — change it with update_component`);
		};
		const implied = impliedAttrs(node.type);
		for (const [attr, value] of Object.entries(parsed.attrs)) switch (true) {
			case attr === "data-id":
			case attr === "data-type":
			case attr === "data-interactions":
			case attr === "data-animations": break;
			case implied[attr] !== void 0: break;
			case attr === "id":
				assign(node, "htmlId", value);
				break;
			case attr === "src":
				setSrc(node, value, path);
				break;
			case attr === "alt": {
				const attrs = { ...node.instanceAttributes ?? {} };
				if (value) attrs.alt = value;
				else delete attrs.alt;
				assignObject(node, "instanceAttributes", attrs);
				break;
			}
			case attr === "data-hidden":
				setHidden(node, value);
				break;
			case attr === "data-icon":
				if (value && value !== iconNameOf(node)) refuse(path, `an icon's markup is not in the HTML — set it with edit_elements {icon: "${value}"}`);
				break;
			case attr.startsWith("data-bind-"):
				setFieldAttr(node, attr.slice(10), value, path);
				break;
			case attr === "data-ref":
				refuse(path, `a ref inside a component instance would be duplicated on every instance — put it on the <${component}> element instead`);
				break;
			case attr === "class":
				refuse(path, `a class inside <${component}> renders nowhere: a mapped node wears the component's. Style the component instead.`);
				break;
			case attr === "href":
				shared("href", node.link);
				break;
			case attr === "source":
			case attr === "data-field":
				shared(attr, node.arg);
				break;
			case NEAR_MISS_BINDINGS.has(attr):
				refuse(path, `'${attr}' binds nothing — a field binding is 'data-field'`);
				break;
			default: shared(attr, node.attributes?.[attr]);
		}
		const has = (attr) => parsed.attrs[attr] !== void 0;
		if (!has("id") && node.htmlId !== void 0) delete node.htmlId;
		if (!has("src") && node.src !== void 0) delete node.src;
		if (!has("data-hidden") && node.hidden !== void 0) delete node.hidden;
		if (!has("alt") && node.instanceAttributes?.alt !== void 0) {
			const attrs = { ...node.instanceAttributes };
			delete attrs.alt;
			assignObject(node, "instanceAttributes", attrs);
		}
		const fields = {};
		for (const [attr, field] of Object.entries(node.fieldAttrs ?? {})) if (has(`data-bind-${attr}`)) fields[attr] = field;
		assignObject(node, "fieldAttrs", fields);
		if (parsed.text !== void 0 && isLeafType(node.type)) setContent(node, parsed, path);
	}
	function applyState(node, parsed, type, path = name(node)) {
		const isInstance = isComponentType(type);
		if (!sameType(node.type, type)) node.type = type;
		const implied = impliedAttrs(type);
		for (const [attr, value] of Object.entries(parsed.attrs)) switch (true) {
			case attr === "data-id":
			case attr === "data-type":
			case attr === "data-interactions":
			case attr === "data-animations": break;
			case implied[attr] !== void 0: break;
			case attr === "data-ref":
				setRef(node, value, path);
				break;
			case attr === "class":
				if (isInstance) refuse(path, `a class on <${parsed.tag}> renders nowhere: an instance wrapper emits no element of its own, and its look is the component's. Style the component instead.`);
				else setClasses(node, value, path);
				break;
			case attr === "id":
				assign(node, "htmlId", value);
				break;
			case attr === "source":
				if (!SOURCE_TYPES.has(type)) refuse(path, `<${parsed.tag}> takes no 'source'; a field binding is 'data-field'`);
				else assign(node, "arg", value);
				break;
			case attr === "data-field":
				if (SOURCE_TYPES.has(type)) refuse(path, `<${parsed.tag}> binds a whole collection with 'source', not 'data-field'`);
				else if (isInstance) refuse(path, `<${parsed.tag}> emits no element, so it has nothing to bind`);
				else assign(node, "arg", value);
				break;
			case attr === "href":
				if (isInstance) refuse(path, `<${parsed.tag}> emits no element, so it has no link`);
				else assign(node, "link", value);
				break;
			case attr === "src":
				setSrc(node, value, path);
				break;
			case attr === "data-hidden":
				setHidden(node, value);
				break;
			case attr === "data-icon":
				if (value && value !== iconNameOf(node)) refuse(path, `an icon's markup is not in the HTML — set it with edit_elements {icon: "${value}"}`);
				break;
			case NEAR_MISS_BINDINGS.has(attr):
				refuse(path, SOURCE_TYPES.has(type) ? `'${attr}' binds nothing — <${parsed.tag}> takes a whole collection as 'source'` : `'${attr}' binds nothing — a field binding is 'data-field'`);
				break;
			case attr.startsWith("data-bind-"):
				setFieldAttr(node, attr.slice(10), value, path);
				break;
			case attr.startsWith("data-variant-"):
				if (!isInstance) refuse(path, `only a component instance wears a variant; <${parsed.tag}> does not`);
				else setVariant(node, attr.slice(13), value);
				break;
			default: if (isInstance) refuse(path, `'${attr}' on <${parsed.tag}> belongs to the component — change it with update_component, or use edit_elements {instanceAttributes} for this placement`);
			else if (!isAllowedAttribute(attr)) refuse(path, `'${attr}' is not an allowed attribute`);
			else setAttr(node, attr, value);
		}
		pruneAbsent(node, parsed, isInstance, () => path);
		if (!isInstance && isLeafType(type) && parsed.text !== void 0) setContent(node, parsed, path);
	}
	function pruneAbsent(node, parsed, isInstance, pathFor) {
		const has = (attr) => parsed.attrs[attr] !== void 0;
		if (!has("data-ref") && node.ref !== void 0) delete node.ref;
		if (!has("id") && node.htmlId !== void 0) delete node.htmlId;
		if (!has("data-hidden") && node.hidden !== void 0) delete node.hidden;
		if (!has(SOURCE_TYPES.has(node.type) ? "source" : "data-field") && node.arg !== void 0) delete node.arg;
		if (isInstance) {
			const written = /* @__PURE__ */ new Map();
			for (const [attr, value] of Object.entries(parsed.attrs)) if (attr.startsWith("data-variant-")) written.set(attr.slice(13), value);
			const picks = {};
			for (const axis of Object.keys(node.variants ?? {})) {
				const value = written.get(axis);
				if (value) picks[axis] = value;
				written.delete(axis);
			}
			for (const [axis, value] of written) if (value) picks[axis] = value;
			assignObject(node, "variants", picks);
			return;
		}
		if (node.variants !== void 0) delete node.variants;
		if (!has("href") && node.link !== void 0) delete node.link;
		if (!has("class") && node.classes !== void 0) {
			if (node.classes.trim()) warn(pathFor(node), `had classes ("${node.classes.trim()}") and the markup gives it none, so they are gone. Write \`class=""\` if that was deliberate; otherwise echo the classes back.`);
			delete node.classes;
		}
		if (!has("src") && node.src !== void 0) delete node.src;
		const implied = impliedAttrs(node.type);
		const attrs = {};
		for (const [attr, value] of Object.entries(node.attributes ?? {})) if (has(attr) || implied[attr] !== void 0) attrs[attr] = value;
		assignObject(node, "attributes", attrs);
		const fields = {};
		for (const [attr, field] of Object.entries(node.fieldAttrs ?? {})) if (has(`data-bind-${attr}`)) fields[attr] = field;
		assignObject(node, "fieldAttrs", fields);
	}
	function setRef(node, value, path) {
		const ref = value.trim();
		if (!ref) {
			delete node.ref;
			return;
		}
		if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(ref)) {
			refuse(path, `'${ref}' is not a valid ref — letters, digits and '-', starting with a letter`);
			return;
		}
		if (node.type === "body") {
			refuse(path, "<body> carries no ref: it is the page root and is already addressable");
			return;
		}
		const mapping = mapped.get(node.id);
		if (mapping && !isInstanceWrapper$1(mapping)) {
			refuse(path, `a ref inside a component instance would be duplicated on every instance — put it on the <${mapping.def.name}> element instead`);
			return;
		}
		assign(node, "ref", ref);
		byRef.set(ref, node);
	}
	/**
	* The `class` attribute is the WHOLE list, so a token the style catalog does
	* not model is KEPT and reported — every renderer and the exporter use
	* `node.classes` verbatim, so dropping one would change the published page.
	* What it costs is that the Style panel cannot show it as a control, which
	* is what the warning says.
	*/
	function setClasses(node, value, path) {
		const tokens = value.split(/\s+/).filter(Boolean);
		for (const token of tokens) if (!isValidClass(token)) warn(path, `'${token}' is kept, but the Style panel has no control for it`);
		assign(node, "classes", tokens.join(" "));
	}
	function setSrc(node, value, path) {
		if (value === "data:…(elided)") return;
		if (value && !SAFE_SRC.test(value)) {
			refuse(path, `'${value}' is not a usable media URL — upload one with upload_media`);
			return;
		}
		assign(node, "src", value);
	}
	function setAttr(node, attr, value) {
		assignObject(node, "attributes", sanitizeAttributes({
			...node.attributes ?? {},
			[attr]: value
		}));
	}
	function setFieldAttr(node, attr, field, path) {
		if (isComponentType(node.type)) {
			refuse(path, "an instance wrapper emits no element, so an attribute has nowhere to land");
			return;
		}
		if (!isAllowedAttribute(attr)) {
			refuse(path, `'${attr}' is not an allowed attribute, so it can't be bound to a field`);
			return;
		}
		const next = { ...node.fieldAttrs ?? {} };
		if (field) next[attr] = field;
		else delete next[attr];
		assignObject(node, "fieldAttrs", next);
	}
	function setVariant(node, axis, option) {
		const next = { ...node.variants ?? {} };
		if (option) next[axis] = option;
		else delete next[axis];
		assignObject(node, "variants", next);
	}
	function setContent(node, parsed, path) {
		const raw = parsed.text ?? "";
		const text = isRich(raw) ? sanitizeRich(raw) : decodeEntities(raw);
		if (!isLeafElement(node.type) && text.trim()) {
			refuse(path, `<${parsed.tag}> is a container — its words go in a child element`);
			return;
		}
		assign(node, "content", text);
	}
	/** `data-hidden` is the editor's hide, not the HTML `hidden` attribute: a
	*  bare one means true, and an explicit `false` is how an instance SHOWS a
	*  part its component hides */
	function setHidden(node, value) {
		const next = value !== "false";
		if (node.hidden !== next) node.hidden = next;
	}
	/** write only a real change, and let an empty value DELETE the key — which
	*  is what makes a round-trip of an unchanged document byte-identical */
	function assign(node, key, value) {
		const next = key === "content" ? value : value.trim();
		if (!next && key !== "content") {
			if (node[key] !== void 0) delete node[key];
			return;
		}
		if (node[key] !== next) node[key] = next;
	}
	function assignObject(node, key, value) {
		if (!Object.keys(value).length) {
			if (node[key] !== void 0) delete node[key];
			return;
		}
		if (JSON.stringify(node[key]) !== JSON.stringify(value)) node[key] = value;
	}
}
var iconNameOf = (node) => node.svg?.match(/data-icon="([a-z0-9:_-]+)"/)?.[1] ?? (node.svg ? "custom" : "");
/** the validation context a project implies */
function contextFromProject(project) {
	const collections = project.collections ?? [];
	return {
		componentNames: (project.components ?? []).map((c) => c.name),
		collectionNames: collections.map((c) => c.name),
		listFieldNames: collections.flatMap((c) => c.fields.filter((f) => f.type === "multi-reference" || f.type === "multi-image").map((f) => f.name)),
		dataOnlyCollections: collections.filter((c) => c.detailRoutes === false).map((c) => c.name)
	};
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
//#region src/lib/shared/structuredData.js
/** validates the `custom` JSON-LD text; null when it is fine, else the reason */
function customSchemaError(text) {
	const raw = String(text ?? "").trim();
	if (!raw) return null;
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		return "Not valid JSON" + (e instanceof Error ? `: ${e.message}` : "");
	}
	const items = Array.isArray(parsed) ? parsed : [parsed];
	for (const item of items) {
		if (!item || typeof item !== "object" || Array.isArray(item)) return "Each entry must be a JSON object";
		if (typeof item["@type"] !== "string") return "Each entry needs a string \"@type\"";
	}
	return null;
}
var canonical = (names) => new Map(names.map((n) => [n.toLowerCase(), n]));
var ELEMENTS$1 = canonical([
	"svg",
	"g",
	"path",
	"circle",
	"ellipse",
	"rect",
	"line",
	"polyline",
	"polygon",
	"defs",
	"clipPath",
	"mask",
	"linearGradient",
	"radialGradient",
	"stop",
	"title",
	"desc"
]);
/** the only elements whose TEXT is kept (escaped); text anywhere else is dropped */
var TEXT_ELEMENTS = /* @__PURE__ */ new Set(["title", "desc"]);
var ATTRIBUTES = canonical([
	"d",
	"cx",
	"cy",
	"r",
	"rx",
	"ry",
	"x",
	"y",
	"x1",
	"y1",
	"x2",
	"y2",
	"points",
	"width",
	"height",
	"viewBox",
	"transform",
	"pathLength",
	"preserveAspectRatio",
	"fill",
	"stroke",
	"opacity",
	"fill-opacity",
	"fill-rule",
	"clip-rule",
	"stroke-width",
	"stroke-linecap",
	"stroke-linejoin",
	"stroke-dasharray",
	"stroke-dashoffset",
	"stroke-miterlimit",
	"stroke-opacity",
	"clip-path",
	"mask",
	"offset",
	"stop-color",
	"stop-opacity",
	"gradientUnits",
	"gradientTransform",
	"fx",
	"fy",
	"spreadMethod",
	"clipPathUnits",
	"maskUnits",
	"maskContentUnits",
	"id",
	"role",
	"aria-hidden",
	"aria-label",
	"data-icon"
]);
/** what a value may be made of. No quotes, no `&` (so no entity can smuggle a
* scheme past the checks below), no angle brackets, no backslash. */
var VALUE_RE = /^[A-Za-z0-9\s.,#%()+\-_/:]*$/;
/** the one `url()` allowed: a reference to something in this same SVG */
var LOCAL_URL_RE = /^url\(#[A-Za-z0-9_-]+\)$/;
var ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
/** the only attributes that may hold a `url(#…)` */
var URL_ATTRIBUTES = /* @__PURE__ */ new Set([
	"fill",
	"stroke",
	"clip-path",
	"mask"
]);
var TOKEN_RE = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<[^>]*>|[^<]+|</g;
var TAG_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)([\s\S]*?)(\/?)>$/;
var ATTR_RE = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g;
var escapeText = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function cleanValue(name, raw) {
	const value = String(raw ?? "").trim();
	if (!VALUE_RE.test(value)) return void 0;
	if (name === "id") return ID_RE.test(value) ? value : void 0;
	if (/url\s*\(/i.test(value)) return URL_ATTRIBUTES.has(name) && LOCAL_URL_RE.test(value) ? value : void 0;
	if (name === "data-icon") return /^[a-z][a-z0-9-]*:[a-z0-9-]+$/.test(value) ? value : void 0;
	if (value.includes(":")) return void 0;
	return value;
}
function cleanAttributes(source, { recolor }) {
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const m of source.matchAll(ATTR_RE)) {
		const name = ATTRIBUTES.get(m[1].toLowerCase());
		if (!name || seen.has(name)) continue;
		let value = cleanValue(name, m[2] ?? m[3] ?? m[4] ?? "");
		if (value === void 0) continue;
		if (recolor && (name === "fill" || name === "stroke" || name === "stop-color")) {
			if (value !== "none") value = "currentColor";
		}
		seen.add(name);
		out.push([name, value]);
	}
	return out;
}
var writeAttributes = (attrs) => attrs.map(([k, v]) => ` ${k}="${v}"`).join("");
/**
* Sanitize SVG markup for inlining. Returns '' for anything that is not a
* single well-formed-enough `<svg>`. Idempotent.
*
* `recolor` (default on) makes the icon follow the text colour: every paint
* other than `none` becomes `currentColor`, and a root that declares no fill
* gets one — an SVG with no fill at all paints BLACK, not the current colour.
*/
function sanitizeInlineSvg(markup, { recolor = true } = {}) {
	if (typeof markup !== "string" || !markup || markup.length > 32768) return "";
	const out = [];
	/** open allowed elements, innermost last */
	const open = [];
	/** the disallowed element being skipped, with everything inside it */
	let skipping = null;
	let skipDepth = 0;
	let closed = false;
	for (const token of markup.match(TOKEN_RE) ?? []) {
		if (closed) break;
		if (token[0] !== "<" || token.length === 1) {
			const parent = open[open.length - 1];
			if (!skipping && parent && TEXT_ELEMENTS.has(parent)) out.push(escapeText(token));
			continue;
		}
		const tag = token.match(TAG_RE);
		if (!tag) continue;
		const closing = tag[1] === "/";
		const rawName = tag[2].toLowerCase();
		const selfClosing = tag[4] === "/";
		if (skipping) {
			if (rawName !== skipping) continue;
			if (closing) {
				if (--skipDepth === 0) skipping = null;
			} else if (!selfClosing) skipDepth++;
			continue;
		}
		const name = ELEMENTS$1.get(rawName);
		if (!name) {
			if (!closing && !selfClosing) {
				skipping = rawName;
				skipDepth = 1;
			}
			continue;
		}
		if (closing) {
			const at = open.lastIndexOf(name);
			if (at === -1) continue;
			for (let i = open.length - 1; i >= at; i--) out.push(`</${open[i]}>`);
			open.length = at;
			if (!open.length) closed = true;
			continue;
		}
		if (!open.length ? name !== "svg" : name === "svg") {
			if (!open.length) return "";
			if (!selfClosing) {
				skipping = rawName;
				skipDepth = 1;
			}
			continue;
		}
		const attrs = cleanAttributes(tag[3], { recolor });
		if (name === "svg") normalizeRoot(attrs, { recolor });
		if (selfClosing) {
			out.push(`<${name}${writeAttributes(attrs)}/>`);
			if (name === "svg") closed = true;
		} else {
			out.push(`<${name}${writeAttributes(attrs)}>`);
			open.push(name);
		}
	}
	for (let i = open.length - 1; i >= 0; i--) out.push(`</${open[i]}>`);
	const result = out.join("");
	return result.startsWith("<svg") ? result : "";
}
/** the root needs a viewBox to scale with its box, and a paint to inherit */
function normalizeRoot(attrs, { recolor }) {
	const get = (k) => attrs.find(([name]) => name === k)?.[1];
	if (!get("viewBox")) {
		const w = Number.parseFloat(get("width") ?? "");
		const h = Number.parseFloat(get("height") ?? "");
		if (w > 0 && h > 0) attrs.push(["viewBox", `0 0 ${w} ${h}`]);
	}
	if (recolor && !get("fill")) attrs.push(["fill", "currentColor"]);
}
/**
* Split sanitized markup into the root's attributes and its inner markup —
* the shape a renderer needs, since the `<svg>` IS the element and carries
* the node's own classes, id and listeners. Returns null for anything
* `sanitizeInlineSvg` did not produce.
*/
function parseInlineSvg(markup) {
	if (typeof markup !== "string") return null;
	const m = markup.match(/^<svg([^>]*?)(?:\/>|>([\s\S]*)<\/svg>)$/);
	if (!m) return null;
	const attrs = {};
	for (const a of m[1].matchAll(/ ([A-Za-z][A-Za-z0-9-]*)="([^"]*)"/g)) attrs[a[1]] = a[2];
	return {
		attrs,
		inner: m[2] ?? ""
	};
}
/** the root attributes every Lucide icon shares */
var LUCIDE_ROOT = "width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"";
/** full markup for a bundled Lucide icon, given its inner markup from the table */
function lucideSvg(name, inner) {
	return sanitizeInlineSvg(`<svg data-icon="lucide:${name}" ${LUCIDE_ROOT}>${inner}</svg>`);
}
/** the bundled icon this markup came from (`arrow-right`), or undefined for a
* custom SVG */
function lucideNameOf(markup) {
	const icon = parseInlineSvg(markup)?.attrs["data-icon"];
	return icon?.startsWith("lucide:") ? icon.slice(7) : void 0;
}
lucideSvg("circle", "<circle cx=\"12\" cy=\"12\" r=\"10\"/>");
//#endregion
//#region src/lib/variantOps.ts
var fail$2 = (error) => ({
	ok: false,
	error
});
var OK = { ok: true };
function nameError(kind, name) {
	if (VARIANT_NAME_RE.test(name)) return null;
	return `An ${kind} name is lowercase letters, digits and dashes, starting with a letter`;
}
/** every instance wrapper of `def`, on every page and inside every other master */
function instancesOf(project, def) {
	const out = [];
	const collect = (nodes) => walkNodes(nodes, (n) => {
		if (n.type === def.name) out.push(n);
	});
	for (const page of project.pages) collect(page.elements);
	for (const other of project.components) if (other !== def) collect(other.root.children);
	return out;
}
/**
* Apply new axes to the project: the def, the master's overrides, and every
* instance's picks.
*
* An instance keeps the look it HAD. Its old pick is read against the old
* axes (an axis it never picked on meant the old default), carried through
* the renames, and stored only where it differs from the new default — so
* changing which option is the default never restyles an existing instance.
*/
function rewrite(project, def, next, renames = {}) {
	const before = def.variants ?? [];
	const oldAxisName = (axis) => renames.axes?.[axis] ?? axis;
	const oldOptionName = (axis, option) => renames.options?.[axis]?.[option] ?? option;
	setComponentMeta(def, {
		category: def.category,
		source: def.source,
		variants: next
	});
	walkNodes([def.root], (node) => {
		const old = node.variantClasses;
		if (!old) return;
		const kept = {};
		for (const axis of next) for (const option of axis.options) {
			const classes = old[variantKey(oldAxisName(axis.name), oldOptionName(axis.name, option))]?.trim();
			if (classes) kept[variantKey(axis.name, option)] = classes;
		}
		if (Object.keys(kept).length) node.variantClasses = kept;
		else delete node.variantClasses;
	});
	for (const instance of instancesOf(project, def)) {
		const old = instance.variants ?? {};
		const kept = {};
		for (const axis of next) {
			const was = before.find((a) => a.name === oldAxisName(axis.name));
			const wore = was ? old[was.name] ?? was.default : void 0;
			const now = axis.options.find((option) => oldOptionName(axis.name, option) === wore);
			if (now !== void 0 && now !== axis.default) kept[axis.name] = now;
		}
		if (Object.keys(kept).length) instance.variants = kept;
		else delete instance.variants;
	}
}
var axesOf = (def) => (def.variants ?? []).map((a) => ({
	name: a.name,
	options: [...a.options],
	default: a.default
}));
function addVariantAxis(project, def, name, options = ["default"]) {
	const axes = axesOf(def);
	const bad = nameError("axis", name) ?? options.map((o) => nameError("option", o)).find(Boolean);
	if (bad) return fail$2(bad);
	if (axes.some((a) => a.name === name)) return fail$2(`This component already has a "${name}" axis`);
	if (!options.length) return fail$2("An axis needs at least one option");
	if (new Set(options).size !== options.length) return fail$2("Option names must be unique");
	rewrite(project, def, [...axes, {
		name,
		options: [...options],
		default: options[0]
	}]);
	return OK;
}
function renameVariantAxis(project, def, from, to) {
	const axes = axesOf(def);
	const axis = axes.find((a) => a.name === from);
	if (!axis) return fail$2(`No "${from}" axis`);
	if (from === to) return OK;
	const bad = nameError("axis", to);
	if (bad) return fail$2(bad);
	if (axes.some((a) => a.name === to)) return fail$2(`This component already has a "${to}" axis`);
	axis.name = to;
	rewrite(project, def, axes, { axes: { [to]: from } });
	return OK;
}
function removeVariantAxis(project, def, name) {
	const axes = axesOf(def);
	if (!axes.some((a) => a.name === name)) return fail$2(`No "${name}" axis`);
	rewrite(project, def, axes.filter((a) => a.name !== name));
	return OK;
}
function addVariantOption(project, def, axisName, option) {
	const axes = axesOf(def);
	const axis = axes.find((a) => a.name === axisName);
	if (!axis) return fail$2(`No "${axisName}" axis`);
	const bad = nameError("option", option);
	if (bad) return fail$2(bad);
	if (axis.options.includes(option)) return fail$2(`"${axisName}" already has a "${option}" option`);
	axis.options.push(option);
	rewrite(project, def, axes);
	return OK;
}
function renameVariantOption(project, def, axisName, from, to) {
	const axes = axesOf(def);
	const axis = axes.find((a) => a.name === axisName);
	if (!axis || !axis.options.includes(from)) return fail$2(`No "${from}" option on "${axisName}"`);
	if (from === to) return OK;
	const bad = nameError("option", to);
	if (bad) return fail$2(bad);
	if (axis.options.includes(to)) return fail$2(`"${axisName}" already has a "${to}" option`);
	axis.options = axis.options.map((o) => o === from ? to : o);
	if (axis.default === from) axis.default = to;
	rewrite(project, def, axes, { options: { [axisName]: { [to]: from } } });
	return OK;
}
/** Removing an option moves the instances wearing it to the axis default. */
function removeVariantOption(project, def, axisName, option) {
	const axes = axesOf(def);
	const axis = axes.find((a) => a.name === axisName);
	if (!axis || !axis.options.includes(option)) return fail$2(`No "${option}" option on "${axisName}"`);
	if (axis.options.length === 1) return fail$2("An axis needs at least one option — remove the axis instead");
	axis.options = axis.options.filter((o) => o !== option);
	if (axis.default === option) axis.default = axis.options[0];
	rewrite(project, def, axes);
	return OK;
}
function setVariantDefault(project, def, axisName, option) {
	const axes = axesOf(def);
	const axis = axes.find((a) => a.name === axisName);
	if (!axis || !axis.options.includes(option)) return fail$2(`No "${option}" option on "${axisName}"`);
	axis.default = option;
	rewrite(project, def, axes);
	return OK;
}
/** Replace a component's axes wholesale (the agent path, and the catalog). Names
*  that survive keep their overrides and picks; the rest are dropped. */
function setVariantAxes(project, def, axes) {
	const seen = /* @__PURE__ */ new Set();
	for (const axis of axes) {
		const bad = nameError("axis", axis.name) ?? axis.options.map((o) => nameError("option", o)).find(Boolean);
		if (bad) return fail$2(bad);
		if (seen.has(axis.name)) return fail$2(`Two axes are named "${axis.name}"`);
		seen.add(axis.name);
		if (!axis.options.length) return fail$2(`"${axis.name}" needs at least one option`);
		if (new Set(axis.options).size !== axis.options.length) return fail$2(`"${axis.name}" has two options with the same name`);
		if (!axis.options.includes(axis.default)) return fail$2(`"${axis.name}": the default "${axis.default}" is not one of its options`);
	}
	rewrite(project, def, axes);
	return OK;
}
/**
* An instance's pick on one axis. Stored only where it differs from the
* default, and re-seated in axis order — see the header.
*/
function setInstancePick(def, wrapper, axisName, option, mirrors = []) {
	const axis = def.variants?.find((a) => a.name === axisName);
	if (!axis) return fail$2(`"${def.name}" has no "${axisName}" axis`);
	if (option !== null && !axis.options.includes(option)) return fail$2(`"${axisName}" has no "${option}" option — it has ${axis.options.join(", ")}`);
	const picks = { ...wrapper.variants ?? {} };
	const inherited = resolvePicks(def, { variants: {} }, mirrors)[axisName];
	if (option === null || option === inherited) delete picks[axisName];
	else picks[axisName] = option;
	const kept = {};
	for (const a of def.variants ?? []) if (picks[a.name] !== void 0) kept[a.name] = picks[a.name];
	if (Object.keys(kept).length) wrapper.variants = kept;
	else delete wrapper.variants;
	return OK;
}
/**
* The override classes of one option on a master node. Empty removes the key,
* and the record itself when it was the last one.
*/
function setVariantClasses(def, node, key, classes) {
	const next = {
		...node.variantClasses ?? {},
		[key]: classes.trim()
	};
	const kept = {};
	for (const axis of def.variants ?? []) for (const option of axis.options) {
		const k = variantKey(axis.name, option);
		if (next[k]) kept[k] = next[k];
	}
	if (Object.keys(kept).length) node.variantClasses = kept;
	else delete node.variantClasses;
}
//#endregion
//#region src/lib/shared/entryScope.js
/**
* Which nodes a route renders under an ENTRY SCOPE, and which scope.
*
* A node is in an entry scope when it is repeated or embedded per entry: inside
* a `:collection-list`, inside a bound `:slider`, or in the template body a
* `:collection-item` embeds. Everything else renders ONCE per route.
*
* This is what decides whether a binding's state key carries the entry part.
* The entry part is carried only when a binding's OWNER and its TARGET share a
* scope — both inside one repeat (a per-row effect, independent per row) or
* both outside every repeat (one shared effect). A row button that opens one
* sheet outside the list therefore keys its effect exactly the way the sheet
* keys it. Keyed off the trigger alone, the button wrote `X@e<row>` while the
* sheet listened on `X`, so the click silently did nothing — which made the
* "ONE overlay per kind, outside the list" recipe unbuildable.
*
* @param {Array<{tree: any[], root: string|null}>} trees
* @returns {Map<string, string>} node id → scope root id (absent = no scope)
*/
function buildScopeRoots(trees) {
	const index = /* @__PURE__ */ new Map();
	const walk = (nodes, root) => {
		for (const n of nodes ?? []) {
			if (root) index.set(n.id, root);
			walk(n.children, isEntryScopeRoot(n) ? n.id : root);
		}
	};
	for (const { tree, root } of trees) walk(tree, root ?? null);
	return index;
}
/** does this node render its children once per entry? */
function isEntryScopeRoot(node) {
	return node.type === "collection-list" || node.type === "slider" && !!node.arg;
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
/** what a click does to the play it drives. `toggle` is the default. */
var ANIMATION_ACTIONS = [
	"toggle",
	"on",
	"off"
];
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
	if (binding.action !== void 0) {
		if (ANIMATION_ACTIONS.indexOf(binding.action) === -1) return fail$1(`action must be one of: ${ANIMATION_ACTIONS.join(", ")}`);
		if (binding.action !== "toggle" && binding.trigger !== "click") return fail$1(`action is only meaningful on a click trigger ('${binding.trigger}' has no state to aim at)`);
	}
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
var SLIDER_DOT_BASE = "size-2 rounded-full bg-current transition-opacity";
`${SLIDER_DOT_BASE}`;
`${SLIDER_DOT_BASE}`;
//#endregion
//#region src/lib/shared/forms.js
/** per-kind caps, in characters. A textarea is the long one by design. */
var FIELD_CAPS = {
	text: 1e3,
	email: 254,
	tel: 40,
	url: 2048,
	number: 40,
	textarea: 1e4,
	select: 200,
	checkbox: 200,
	radio: 200
};
/** which element types are form controls, and the kind each defaults to */
var CONTROL_KINDS = {
	input: "text",
	textarea: "textarea",
	select: "select",
	dropdown: "select",
	checkbox: "checkbox",
	radio: "radio"
};
/** an `<input type="…">` the browser validates, mapped to our kinds.
*
* `radio` and `checkbox` are here as well as being element types of their own:
* the registry bakes the attribute for `:radio`/`:checkbox`, but a plain
* `:input` can carry `type="radio"` through the Attributes rows, and reading
* that as text would lose the value grouping AND the option allowlist the
* endpoint checks against. */
var INPUT_TYPE_KINDS = {
	email: "email",
	tel: "tel",
	url: "url",
	number: "number",
	text: "text",
	search: "text",
	password: "text",
	radio: "radio",
	checkbox: "checkbox"
};
/** the state blocks, which are never submitted and never repeated */
var FORM_STATE_TYPES = ["form-success", "form-error"];
/** is this node a form control that could carry a name? */
var isFormControl = (type) => Object.hasOwn(CONTROL_KINDS, type);
/**
* Every named field of one form, plus the controls that have no name.
*
* `resolve(node)` gives the effective attributes of a node — the caller passes
* the one that knows about component instances (a control inside a `<Field>`
* reads its name from the master, and its per-placement override from
* `instanceAttributes`). Without that indirection a form built from components
* would report no fields at all.
*
* Returns `{fields, unnamed, duplicates}`. `fields` is what the manifest
* stores and the endpoint allowlists against.
*/
function collectFormFields(formNode, resolve) {
	const fields = [];
	const unnamed = [];
	const seen = /* @__PURE__ */ new Map();
	const attrsOf = (node) => resolve ? resolve(node) ?? {} : node.attributes ?? {};
	const walk = (node) => {
		if (!node || typeof node !== "object") return;
		if (node !== formNode && node.type === "form") return;
		if (FORM_STATE_TYPES.includes(node.type)) return;
		if (isFormControl(node.type)) {
			const attrs = attrsOf(node);
			const name = String(attrs.name ?? "").trim();
			if (!name) unnamed.push({
				id: node.id,
				type: node.type
			});
			else if (name.startsWith("_")) unnamed.push({
				id: node.id,
				type: node.type,
				reserved: true,
				name
			});
			else {
				const kind = kindFor(node, attrs);
				const field = {
					name,
					kind,
					required: attrs.required === "" || attrs.required === "required" || attrs.required === "true",
					maxLength: capFor(kind, attrs.maxlength)
				};
				if (kind === "select") field.options = optionValues(node);
				if (kind === "radio" || kind === "checkbox") field.value = String(attrs.value ?? "on");
				const prior = seen.get(name);
				if (prior) {
					if (prior.kind === "radio" && kind === "radio") prior.options = [.../* @__PURE__ */ new Set([...prior.options ?? [], field.value])];
					else prior.duplicate = true;
				} else {
					if (kind === "radio") field.options = [field.value];
					seen.set(name, field);
					fields.push(field);
				}
			}
		}
		for (const child of node.children ?? []) walk(child);
	};
	walk(formNode);
	return {
		fields,
		unnamed,
		duplicates: fields.filter((f) => f.duplicate).map((f) => f.name)
	};
}
function kindFor(node, attrs) {
	const base = CONTROL_KINDS[node.type] ?? "text";
	if (node.type !== "input") return base;
	return INPUT_TYPE_KINDS[String(attrs.type ?? "text").toLowerCase()] ?? "text";
}
function capFor(kind, maxlength) {
	const ceiling = FIELD_CAPS[kind] ?? FIELD_CAPS.text;
	const own = Number(maxlength);
	return Number.isFinite(own) && own > 0 ? Math.min(own, ceiling) : ceiling;
}
/** the values a `<select>` offers, from its option children */
function optionValues(node) {
	const out = [];
	for (const child of node.children ?? []) {
		if (child.type !== "option") continue;
		const attrs = child.attributes ?? {};
		out.push(String(attrs.value ?? child.content ?? ""));
	}
	return out;
}
/** a redirect must be an internal route: a root-relative path, nothing else */
function isInternalRoute(value) {
	const text = String(value ?? "");
	if (!text) return true;
	if (!text.startsWith("/")) return false;
	if (text.startsWith("//")) return false;
	if (/[\\]/.test(text)) return false;
	try {
		if (new URL(text, "https://x.invalid").origin !== "https://x.invalid") return false;
	} catch {
		return false;
	}
	return true;
}
/** the reason this form config is unusable, or null */
function formConfigError(config) {
	if (!config || typeof config !== "object") return null;
	if (config.redirect && !isInternalRoute(config.redirect)) return "redirect must be a path on this site, like /thanks";
	if (config.name !== void 0 && String(config.name).length > 80) return "a form name is at most 80 characters";
	if (config.externalAction) {
		if (config.enabled) return "a form cannot both accept submissions here and post to another service";
		try {
			if (new URL(config.externalAction).protocol !== "https:") return "the external action must be an https:// URL";
		} catch {
			return "the external action must be an https:// URL";
		}
	}
	return null;
}
/** does this form take submissions on this instance? */
var formEnabled = (config) => !!config && config.enabled === true;
/** the label a form is listed under */
var formName = (config) => {
	return String(config?.name ?? "").trim() || "Form";
};
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
//#region src/lib/catalog/entries/helpers.ts
/**
* What the entries share.
*
* Every class in an entry must pass `isValidClass` — a class written straight
* into `node.classes` renders and exports fine but can't be re-typed in the
* Style panel once removed, which is a trap to hand a user. `npm run
* check:catalog` holds every entry to that. Known rejects to avoid: `/NN`
* opacity forms, `top-full`, `place-items-*`, `min-h-svh`.
*
* Hover and focus are plain `hover:` / `focus-visible:` variants; checked and
* open states that CSS can see (`has-[:checked]:`, `group-hover:`) are plain
* variants too. Interactions are for what only a click can decide.
*/
var FOCUS = "focus-visible:ring-2 focus-visible:ring-ring";
var CARD = "rounded-xl border border-border bg-card text-card-foreground shadow-sm";
var CARD_TOKENS = [
	"border",
	"card",
	"card-foreground"
];
var FIELD = `w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none ${FOCUS}`;
var FIELD_TOKENS = [
	"input",
	"background",
	"foreground",
	"ring"
];
var PLACEHOLDER = "placeholder:text-muted-foreground";
/** a floating surface: a menu, a popover, a hover card */
var SURFACE = "rounded-lg border border-border bg-card text-card-foreground shadow-md";
/** text, as the one child of a `button` / `link` / `label` — they are
*  containers, and their words live in a span */
var words = (content, key) => ({
	type: "span",
	content,
	...key ? { key } : {}
});
var icon = (name, classes = "size-4 shrink-0", extra = {}) => ({
	type: "icon",
	icon: name,
	classes,
	...extra
});
var link = (content, href, classes) => ({
	type: "link",
	link: href,
	classes,
	children: [words(content)]
});
/**
* An instance of the Button entry. What is inside belongs to Button — restyle
* it there and every host follows — so a host only says which look it wears,
* what it reads, and which of its two icons show.
*/
var button = (label, opts = {}) => {
	const variants = {};
	if (opts.variant) variants.variant = opts.variant;
	if (opts.size) variants.size = opts.size;
	const parts = { label: { content: label } };
	if (opts.iconOnly) parts.label = {
		content: label,
		hidden: true
	};
	if (opts.start) parts["icon-start"] = {
		icon: opts.start,
		hidden: false
	};
	if (opts.end) parts["icon-end"] = {
		icon: opts.end,
		hidden: false
	};
	return {
		type: "Button",
		component: "button",
		...Object.keys(variants).length ? { variants } : {},
		parts
	};
};
/**
* A host cannot bind an interaction ON a nested instance — its bindings are
* the component's own. So the trigger is a wrapper the host owns: it adds no
* box (`contents`), and the click on the button inside bubbles up to it.
*/
var trigger = (child, interactions, classes = "contents") => ({
	type: "div",
	classes,
	interactions,
	children: [child]
});
//#endregion
//#region src/lib/catalog/entries/primitives.ts
/**
* Buttons, badges and the small display pieces.
*
* One component per THING, not per look: a Button is a Button, and default /
* outline / ghost are options it wears. See ./helpers for the class rules.
*/
var PRIMITIVES = [
	{
		key: "button",
		name: "Button",
		category: "Buttons",
		description: "An action, in six looks and four sizes, with an optional icon on either side.",
		tokens: [
			"ring",
			"primary",
			"primary-foreground",
			"secondary",
			"secondary-foreground",
			"destructive",
			"destructive-foreground",
			"input",
			"background",
			"foreground",
			"accent",
			"accent-foreground"
		],
		variants: [{
			name: "variant",
			options: [
				"default",
				"secondary",
				"outline",
				"ghost",
				"destructive",
				"link"
			],
			default: "default"
		}, {
			name: "size",
			options: [
				"md",
				"sm",
				"lg",
				"icon"
			],
			default: "md"
		}],
		root: {
			type: "button",
			key: "button",
			classes: `inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium whitespace-nowrap text-primary-foreground transition-colors outline-none hover:opacity-90 disabled:opacity-50 ${FOCUS}`,
			variantClasses: {
				"variant:secondary": "bg-secondary text-secondary-foreground",
				"variant:outline": "border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground hover:opacity-100",
				"variant:ghost": "bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground hover:opacity-100",
				"variant:destructive": "bg-destructive text-destructive-foreground",
				"variant:link": "h-auto bg-transparent px-0 text-primary underline-offset-4 hover:underline hover:opacity-100",
				"size:sm": "h-8 gap-1.5 rounded-md px-3 text-xs",
				"size:lg": "h-10 px-6 text-base",
				"size:icon": "w-9 px-0"
			},
			children: [
				icon("arrow-left", "size-4 shrink-0", {
					key: "icon-start",
					hidden: true
				}),
				words("Button", "label"),
				icon("arrow-right", "size-4 shrink-0", {
					key: "icon-end",
					hidden: true
				})
			]
		}
	},
	{
		key: "badge",
		name: "Badge",
		category: "Badges",
		description: "A status or a count, in four looks.",
		tokens: [
			"primary",
			"primary-foreground",
			"secondary",
			"secondary-foreground",
			"destructive",
			"destructive-foreground",
			"border",
			"foreground"
		],
		variants: [{
			name: "variant",
			options: [
				"default",
				"secondary",
				"outline",
				"destructive"
			],
			default: "default"
		}],
		root: {
			type: "span",
			key: "label",
			content: "Badge",
			classes: "inline-flex w-fit items-center rounded-full border border-transparent bg-primary px-2 py-1 text-xs font-medium text-primary-foreground",
			variantClasses: {
				"variant:secondary": "bg-secondary text-secondary-foreground",
				"variant:outline": "border-border bg-transparent text-foreground",
				"variant:destructive": "bg-destructive text-destructive-foreground"
			}
		}
	},
	{
		key: "avatar",
		name: "Avatar",
		category: "Display",
		description: "A round profile image.",
		tokens: ["muted"],
		root: {
			type: "div",
			classes: "size-10 shrink-0 overflow-hidden rounded-full bg-muted",
			children: [{
				type: "image",
				key: "image",
				classes: "h-full w-full object-cover"
			}]
		}
	},
	{
		key: "separator",
		name: "Separator",
		category: "Display",
		description: "A hairline rule between sections.",
		tokens: ["border"],
		root: {
			type: "div",
			classes: "h-px w-full bg-border"
		}
	},
	{
		key: "kbd",
		name: "Kbd",
		category: "Display",
		description: "A key, or a shortcut.",
		tokens: [
			"border",
			"muted",
			"muted-foreground"
		],
		root: {
			type: "span",
			key: "label",
			content: "⌘K",
			classes: "inline-flex h-5 w-fit items-center rounded-md border border-border bg-muted px-1.5 font-mono text-xs font-medium text-muted-foreground"
		}
	},
	{
		key: "skeleton",
		name: "Skeleton",
		category: "Display",
		description: "A placeholder that pulses while content loads.",
		tokens: ["muted"],
		root: {
			type: "div",
			classes: "h-4 w-full animate-pulse rounded-md bg-muted"
		}
	},
	{
		key: "spinner",
		name: "Spinner",
		category: "Display",
		description: "Something is happening.",
		tokens: ["muted-foreground"],
		root: icon("loader-circle", "size-4 shrink-0 animate-spin text-muted-foreground", { attributes: { "aria-label": "Loading" } })
	},
	{
		key: "progress",
		name: "Progress",
		category: "Display",
		description: "How far along. Set the bar’s width to the share done.",
		tokens: ["muted", "primary"],
		root: {
			type: "div",
			classes: "h-2 w-full overflow-hidden rounded-full bg-muted",
			attributes: { role: "progressbar" },
			children: [{
				type: "div",
				key: "bar",
				classes: "h-full w-1/2 rounded-full bg-primary transition-all"
			}]
		}
	},
	{
		key: "empty",
		name: "Empty",
		category: "Display",
		description: "What a list shows when there is nothing in it yet.",
		tokens: [
			"border",
			"muted",
			"muted-foreground",
			"foreground"
		],
		root: {
			type: "div",
			classes: "flex w-full flex-col items-center gap-4 rounded-xl border border-dashed border-border p-10 text-center",
			children: [
				{
					type: "div",
					classes: "flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground",
					children: [icon("inbox", "size-5 shrink-0", { key: "icon" })]
				},
				{
					type: "div",
					classes: "flex flex-col gap-1",
					children: [{
						type: "h3",
						key: "title",
						content: "Nothing here yet",
						classes: "text-base font-semibold text-foreground"
					}, {
						type: "paragraph",
						key: "description",
						content: "Create your first one to see it listed here.",
						classes: "text-sm text-muted-foreground"
					}]
				},
				button("Create one", { start: "plus" })
			]
		}
	}
];
//#endregion
//#region src/lib/catalog/entries/forms.ts
/**
* Form controls.
*
* The ones with a state — switch, toggle, radio — are REAL inputs, so they
* work with no JavaScript, submit with a form and answer to the keyboard. What
* shows the state is CSS reading the input (`has-[:checked]:`), and the input
* itself is visually hidden (`sr-only`), not removed.
*
* No `for` / `id` pairing anywhere: `htmlId` does not replicate across
* instances, so every instance would claim the same id. A `label` is a
* container, so the control simply sits inside it.
*/
var LABEL = "text-sm font-medium text-foreground";
var radio = (label, value, checked = false) => ({
	type: "label",
	classes: "flex cursor-pointer items-center gap-2",
	children: [{
		type: "radio",
		classes: `size-4 shrink-0 border border-input accent-primary outline-none ${FOCUS}`,
		attributes: {
			name: "choice",
			value,
			...checked ? { checked: "" } : {}
		}
	}, {
		type: "span",
		content: label,
		classes: LABEL
	}]
});
var toggleItem = (iconName, label, value) => ({
	type: "label",
	classes: "inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted has-[:checked]:bg-accent has-[:checked]:text-accent-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
	attributes: { "aria-label": label },
	children: [{
		type: "radio",
		classes: "sr-only",
		attributes: {
			name: "align",
			value
		}
	}, icon(iconName)]
});
var FORMS = [
	{
		key: "input",
		name: "Input",
		category: "Forms",
		description: "A single-line text field.",
		tokens: [...FIELD_TOKENS, "muted-foreground"],
		root: {
			type: "input",
			key: "input",
			classes: `h-9 ${FIELD} ${PLACEHOLDER}`,
			attributes: { type: "text" }
		}
	},
	{
		key: "textarea",
		name: "Textarea",
		category: "Forms",
		description: "A multi-line text field.",
		tokens: [...FIELD_TOKENS, "muted-foreground"],
		root: {
			type: "textarea",
			key: "input",
			classes: `py-2 ${FIELD} ${PLACEHOLDER}`,
			attributes: {
				placeholder: "Your message",
				name: "message",
				rows: "4"
			}
		}
	},
	{
		key: "select",
		name: "Select",
		category: "Forms",
		description: "A dropdown of fixed choices.",
		tokens: [...FIELD_TOKENS, "muted-foreground"],
		root: {
			type: "div",
			classes: "relative w-full",
			children: [{
				type: "select",
				key: "input",
				classes: `h-9 appearance-none cursor-pointer pr-9 ${FIELD}`,
				attributes: { name: "choice" },
				children: [
					{
						type: "option",
						content: "First option"
					},
					{
						type: "option",
						content: "Second option"
					},
					{
						type: "option",
						content: "Third option"
					}
				]
			}, icon("chevron-down", "pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground")]
		}
	},
	{
		key: "label",
		name: "Label",
		category: "Forms",
		description: "A form field label.",
		tokens: ["foreground"],
		root: {
			type: "label",
			classes: LABEL,
			children: [words("Label", "label")]
		}
	},
	{
		key: "field",
		name: "Field",
		category: "Forms",
		description: "A label over an input, with a line of help under it.",
		tokens: [...FIELD_TOKENS, "muted-foreground"],
		root: {
			type: "label",
			classes: "flex w-full flex-col gap-1.5",
			children: [
				{
					type: "span",
					key: "label",
					content: "Email",
					classes: LABEL
				},
				{
					type: "input",
					key: "input",
					classes: `h-9 ${FIELD} ${PLACEHOLDER}`,
					attributes: {
						type: "email",
						placeholder: "you@example.com",
						name: "email"
					}
				},
				{
					type: "span",
					key: "help",
					content: "We only use it to reply.",
					classes: "text-xs text-muted-foreground",
					hidden: true
				}
			]
		}
	},
	{
		key: "checkbox",
		name: "Checkbox",
		category: "Forms",
		description: "A checkbox with its label.",
		tokens: [
			"input",
			"primary",
			"foreground",
			"ring"
		],
		root: {
			type: "label",
			classes: "flex cursor-pointer items-center gap-2",
			children: [{
				type: "checkbox",
				key: "input",
				classes: `size-4 shrink-0 rounded-md border border-input accent-primary outline-none ${FOCUS}`,
				attributes: { name: "accept" }
			}, {
				type: "span",
				key: "label",
				content: "Accept the terms",
				classes: LABEL
			}]
		}
	},
	{
		key: "radio-group",
		name: "RadioGroup",
		category: "Forms",
		description: "One choice out of a few.",
		tokens: [
			"input",
			"primary",
			"foreground",
			"ring"
		],
		root: {
			type: "fieldset",
			classes: "flex flex-col gap-3",
			children: [
				radio("Comfortable", "comfortable", true),
				radio("Compact", "compact"),
				radio("Spacious", "spacious")
			]
		}
	},
	{
		key: "switch",
		name: "Switch",
		category: "Forms",
		description: "On or off, at once.",
		tokens: [
			"input",
			"primary",
			"background",
			"foreground",
			"ring"
		],
		root: {
			type: "label",
			classes: "group flex w-fit cursor-pointer items-center gap-2",
			children: [
				{
					type: "checkbox",
					key: "input",
					classes: "sr-only",
					attributes: {
						name: "enabled",
						role: "switch"
					}
				},
				{
					type: "div",
					key: "track",
					classes: "relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors group-has-[:checked]:bg-primary group-has-[:focus-visible]:ring-2 group-has-[:focus-visible]:ring-ring",
					children: [{
						type: "div",
						key: "thumb",
						classes: "absolute top-[2px] left-[2px] size-4 rounded-full bg-background shadow-sm transition-transform group-has-[:checked]:translate-x-4"
					}]
				},
				{
					type: "span",
					key: "label",
					content: "Airplane mode",
					classes: LABEL
				}
			]
		}
	},
	{
		key: "toggle",
		name: "Toggle",
		category: "Forms",
		description: "A button that stays pressed.",
		tokens: [
			"muted",
			"muted-foreground",
			"accent",
			"accent-foreground",
			"ring"
		],
		root: {
			type: "label",
			classes: "inline-flex h-9 w-fit cursor-pointer items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted has-[:checked]:bg-accent has-[:checked]:text-accent-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
			children: [
				{
					type: "checkbox",
					key: "input",
					classes: "sr-only",
					attributes: { name: "bold" }
				},
				icon("bold", "size-4 shrink-0", { key: "icon" }),
				{
					type: "span",
					key: "label",
					content: "Bold"
				}
			]
		}
	},
	{
		key: "toggle-group",
		name: "ToggleGroup",
		category: "Forms",
		description: "A row of toggles where one is pressed at a time.",
		tokens: [
			"border",
			"muted",
			"muted-foreground",
			"accent",
			"accent-foreground",
			"ring"
		],
		root: {
			type: "fieldset",
			classes: "flex w-fit items-center gap-1 rounded-lg border border-border p-1",
			children: [
				toggleItem("text-align-start", "Align left", "left"),
				toggleItem("text-align-center", "Align center", "center"),
				toggleItem("text-align-end", "Align right", "right")
			]
		}
	}
];
//#endregion
//#region src/lib/catalog/entries/content.ts
/**
* Cards, feedback, marketing blocks and page furniture — everything static.
* The interactive pieces live in ./interactive.
*
* Where one of these has a button, it holds an instance of the Button entry
* rather than a copy of its markup: restyle Button once and every card, hero
* and pricing plan follows. See ./helpers for the class rules.
*/
var NAV_LINK = "text-sm text-muted-foreground transition-colors hover:text-foreground";
var navLink = (content, href) => link(content, href, NAV_LINK);
var CARD_TITLE = "text-lg font-semibold tracking-tight text-card-foreground";
var cell = (content, classes = "") => ({
	type: "td",
	classes: `p-2 align-middle ${classes}`.trim(),
	children: [{
		type: "text",
		content
	}]
});
var headCell = (content, classes = "") => ({
	type: "th",
	classes: `h-10 px-2 text-left align-middle font-medium text-muted-foreground ${classes}`.trim(),
	children: [{
		type: "text",
		content
	}]
});
var row = (...cells) => ({
	type: "tr",
	classes: "border-b border-border transition-colors hover:bg-muted",
	children: cells
});
var feature = (text) => ({
	type: "list-item",
	classes: "flex items-center gap-2 text-sm text-muted-foreground",
	children: [icon("check", "size-4 shrink-0 text-primary"), {
		type: "text",
		content: text
	}]
});
var slide = (title) => ({
	type: "div",
	classes: "flex h-48 items-center justify-center rounded-xl bg-muted",
	children: [{
		type: "span",
		content: title,
		classes: "text-2xl font-semibold text-muted-foreground"
	}]
});
var CONTENT = [
	{
		key: "card",
		name: "Card",
		category: "Cards",
		description: "A titled panel with body copy, and a footer action you can switch on.",
		tokens: [...CARD_TOKENS, "muted-foreground"],
		root: {
			type: "div",
			classes: CARD,
			children: [
				{
					type: "div",
					classes: "flex flex-col gap-1.5 p-6",
					children: [{
						type: "h3",
						key: "title",
						content: "Card title",
						classes: CARD_TITLE
					}, {
						type: "paragraph",
						key: "description",
						content: "A short line about what this card holds.",
						classes: "text-sm text-muted-foreground"
					}]
				},
				{
					type: "div",
					classes: "px-6 pb-6",
					children: [{
						type: "paragraph",
						key: "content",
						content: "Card content goes here.",
						classes: "text-sm text-card-foreground"
					}]
				},
				{
					type: "div",
					key: "footer",
					hidden: true,
					classes: "flex items-center justify-end gap-2 border-t border-border px-6 py-4",
					children: [button("Continue")]
				}
			]
		}
	},
	{
		key: "alert",
		name: "Alert",
		category: "Feedback",
		description: "A notice, plain or for an error.",
		tokens: [
			"border",
			"background",
			"foreground",
			"muted-foreground",
			"destructive"
		],
		variants: [{
			name: "variant",
			options: ["default", "destructive"],
			default: "default"
		}],
		root: {
			type: "div",
			classes: "flex w-full gap-3 rounded-lg border border-border bg-background p-4 text-foreground",
			attributes: { role: "alert" },
			variantClasses: { "variant:destructive": "border-destructive text-destructive" },
			children: [icon("info", "mt-0.5 size-4 shrink-0", { key: "icon" }), {
				type: "div",
				classes: "flex min-w-0 flex-col gap-1",
				children: [{
					type: "h4",
					key: "title",
					content: "Heads up",
					classes: "text-sm font-medium"
				}, {
					type: "paragraph",
					key: "description",
					content: "Something worth knowing before you carry on.",
					classes: "text-sm text-muted-foreground",
					variantClasses: { "variant:destructive": "text-destructive" }
				}]
			}]
		}
	},
	{
		key: "testimonial",
		name: "Testimonial",
		category: "Content",
		description: "A quote with an attributed author.",
		tokens: [
			...CARD_TOKENS,
			"muted",
			"muted-foreground"
		],
		root: {
			type: "div",
			classes: `flex flex-col gap-4 p-6 ${CARD}`,
			children: [{
				type: "paragraph",
				key: "quote",
				content: "This is the single best tool we have adopted all year.",
				classes: "text-base text-card-foreground"
			}, {
				type: "div",
				classes: "flex items-center gap-3",
				children: [{
					type: "div",
					classes: "size-10 shrink-0 overflow-hidden rounded-full bg-muted",
					children: [{
						type: "image",
						key: "photo",
						classes: "h-full w-full object-cover"
					}]
				}, {
					type: "div",
					classes: "flex min-w-0 flex-col",
					children: [{
						type: "span",
						key: "name",
						content: "Jane Doe",
						classes: "truncate text-sm font-medium text-card-foreground"
					}, {
						type: "span",
						key: "role",
						content: "Head of Design, Acme",
						classes: "truncate text-xs text-muted-foreground"
					}]
				}]
			}]
		}
	},
	{
		key: "pricing-card",
		name: "PricingCard",
		category: "Content",
		description: "A plan, its price and what it includes.",
		tokens: [
			...CARD_TOKENS,
			"muted-foreground",
			"primary"
		],
		root: {
			type: "div",
			classes: `flex flex-col gap-6 p-6 ${CARD}`,
			children: [
				{
					type: "div",
					classes: "flex flex-col gap-2",
					children: [{
						type: "div",
						classes: "flex items-center justify-between gap-2",
						children: [{
							type: "span",
							key: "plan",
							content: "Pro",
							classes: "text-sm font-medium text-muted-foreground"
						}, {
							type: "Badge",
							component: "badge",
							key: "badge",
							hidden: true,
							variants: { variant: "secondary" },
							parts: { label: { content: "Most popular" } }
						}]
					}, {
						type: "div",
						classes: "flex items-end gap-1",
						children: [{
							type: "span",
							key: "price",
							content: "$29",
							classes: "text-4xl font-bold tracking-tight text-card-foreground"
						}, {
							type: "span",
							key: "period",
							content: "/month",
							classes: "text-sm text-muted-foreground"
						}]
					}]
				},
				{
					type: "list",
					classes: "flex flex-col gap-2",
					children: [
						feature("Unlimited projects"),
						feature("Priority support"),
						feature("Custom domains")
					]
				},
				{
					type: "div",
					classes: "flex flex-col",
					children: [button("Get started")]
				}
			]
		}
	},
	{
		key: "feature-block",
		name: "FeatureBlock",
		category: "Content",
		description: "An icon, a heading and a line — for a feature grid.",
		tokens: [
			"muted",
			"foreground",
			"muted-foreground"
		],
		root: {
			type: "div",
			classes: "flex flex-col gap-3",
			children: [
				{
					type: "div",
					classes: "flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground",
					children: [icon("zap", "size-5 shrink-0", { key: "icon" })]
				},
				{
					type: "h3",
					key: "title",
					content: "Fast by default",
					classes: "text-base font-semibold text-foreground"
				},
				{
					type: "paragraph",
					key: "description",
					content: "A sentence on why this matters to the reader.",
					classes: "text-sm text-muted-foreground"
				}
			]
		}
	},
	{
		key: "table",
		name: "Table",
		category: "Content",
		description: "Rows and columns, with a header.",
		tokens: [
			"border",
			"muted",
			"muted-foreground",
			"foreground"
		],
		root: {
			type: "div",
			classes: "w-full overflow-x-auto",
			children: [{
				type: "table",
				classes: "w-full border-collapse text-sm text-foreground",
				children: [{
					type: "thead",
					children: [{
						type: "tr",
						classes: "border-b border-border",
						children: [
							headCell("Invoice"),
							headCell("Status"),
							headCell("Amount", "text-right")
						]
					}]
				}, {
					type: "tbody",
					children: [
						row(cell("INV-001", "font-medium"), cell("Paid"), cell("$250.00", "text-right")),
						row(cell("INV-002", "font-medium"), cell("Pending"), cell("$150.00", "text-right")),
						row(cell("INV-003", "font-medium"), cell("Unpaid"), cell("$350.00", "text-right"))
					]
				}]
			}]
		}
	},
	{
		key: "carousel",
		name: "Carousel",
		category: "Content",
		description: "Slides you step through, with arrows and dots.",
		tokens: ["muted", "muted-foreground"],
		root: {
			type: "slider",
			classes: "w-full",
			slider: { gap: 16 },
			children: [
				slide("One"),
				slide("Two"),
				slide("Three")
			]
		}
	},
	{
		key: "pagination",
		name: "Pagination",
		category: "Navigation",
		description: "Previous, next, and the pages between.",
		tokens: [],
		root: {
			type: "nav",
			classes: "flex items-center justify-center gap-1",
			attributes: { "aria-label": "Pagination" },
			children: [
				button("Previous", {
					variant: "ghost",
					start: "chevron-left"
				}),
				button("1", {
					variant: "outline",
					size: "icon"
				}),
				button("2", {
					variant: "ghost",
					size: "icon"
				}),
				button("3", {
					variant: "ghost",
					size: "icon"
				}),
				button("Next", {
					variant: "ghost",
					end: "chevron-right"
				})
			]
		}
	},
	{
		key: "breadcrumb",
		name: "Breadcrumb",
		category: "Navigation",
		description: "The trail back up to the home page.",
		tokens: ["foreground", "muted-foreground"],
		root: {
			type: "nav",
			classes: "flex items-center gap-2 text-muted-foreground",
			attributes: { "aria-label": "Breadcrumb" },
			children: [
				navLink("Home", "/"),
				icon("chevron-right", "size-3 shrink-0"),
				navLink("Docs", "/docs"),
				icon("chevron-right", "size-3 shrink-0"),
				{
					type: "span",
					key: "current",
					content: "This page",
					classes: "text-sm font-medium text-foreground"
				}
			]
		}
	},
	{
		key: "footer",
		name: "Footer",
		category: "Navigation",
		description: "A site footer with links and a copyright line.",
		tokens: [
			"border",
			"background",
			"foreground",
			"muted-foreground"
		],
		root: {
			type: "footer",
			classes: "flex flex-col gap-6 border-t border-border bg-background px-6 py-12",
			children: [{
				type: "div",
				classes: "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between",
				children: [{
					type: "span",
					key: "brand",
					content: "Acme Inc.",
					classes: "text-sm font-semibold text-foreground"
				}, {
					type: "nav",
					classes: "flex items-center gap-6",
					children: [
						navLink("Privacy", "/privacy"),
						navLink("Terms", "/terms"),
						navLink("Contact", "/contact")
					]
				}]
			}, {
				type: "span",
				key: "legal",
				content: "© Acme Inc. All rights reserved.",
				classes: "text-xs text-muted-foreground"
			}]
		}
	},
	{
		key: "hero",
		name: "Hero",
		category: "Sections",
		description: "A headline, a line of copy and two actions.",
		tokens: ["foreground", "muted-foreground"],
		root: {
			type: "section",
			classes: "flex flex-col items-center gap-6 px-6 py-24 text-center",
			children: [
				{
					type: "h1",
					key: "title",
					content: "Build your site, faster",
					classes: "max-w-3xl text-4xl font-bold tracking-tight text-foreground md:text-5xl"
				},
				{
					type: "paragraph",
					key: "description",
					content: "One sentence on what this does and who it is for.",
					classes: "max-w-2xl text-base text-muted-foreground"
				},
				{
					type: "div",
					classes: "flex flex-col gap-3 sm:flex-row",
					children: [button("Get started", {
						size: "lg",
						end: "arrow-right"
					}), button("Learn more", {
						variant: "outline",
						size: "lg"
					})]
				}
			]
		}
	},
	{
		key: "cta",
		name: "CallToAction",
		category: "Sections",
		description: "A closing band that asks for the click.",
		tokens: ["primary", "primary-foreground"],
		root: {
			type: "section",
			classes: "flex flex-col items-center gap-4 rounded-xl bg-primary px-6 py-16 text-center",
			children: [
				{
					type: "h2",
					key: "title",
					content: "Ready to get started?",
					classes: "text-3xl font-bold tracking-tight text-primary-foreground"
				},
				{
					type: "paragraph",
					key: "description",
					content: "Set up your first site in a couple of minutes.",
					classes: "max-w-xl text-sm text-primary-foreground"
				},
				button("Start for free", {
					variant: "secondary",
					size: "lg"
				})
			]
		}
	}
];
//#endregion
//#region src/lib/catalog/entries/interactive.ts
/**
* The entries that open, close and switch.
*
* Two rules shape the ones that carry interaction bindings:
*
* · **State is keyed by (interaction, target), not by binding.** That is what
*   lets an open button, a close button and an overlay drive one effect, and
*   it is why every binding below that means "the same panel" names the same
*   target.
* · **A `group` holds ONE open key.** So a grouped binding and an ungrouped
*   one may never share a target, and an `off` binding never carries a group.
*
* Effect names are entry-specific ("Accordion · open"): the interaction
* library is project-wide and shared by reference, so a generic "Show" would
* mean editing one component silently restyles another.
*
* Where the trigger is a Button, the binding sits on a wrapper the entry owns
* (`trigger` in ./helpers): a host cannot bind on an instance it holds.
*
* Tooltip and HoverCard carry no binding at all. Hover is something CSS can
* see (`group-hover:`), so they work with no JavaScript.
*/
var MENU_ITEM = "rounded-md px-2 py-1.5 text-sm text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground";
var NAVBAR_LINK = "text-sm text-muted-foreground transition-colors hover:text-foreground";
var MOBILE_LINK = "rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground";
var OVERLAY = "absolute inset-0 bg-black/50";
var FADE_LAYER = "invisible fixed inset-0 z-50 opacity-0 transition-opacity";
var DIALOG_PANEL = `relative z-50 flex w-full max-w-md flex-col gap-4 rounded-xl p-6 shadow-lg border border-border bg-card text-card-foreground`;
/** one accordion row: a full-width trigger over a panel that starts hidden */
var accordionItem = (key, question, answer) => ({
	type: "div",
	classes: "flex flex-col border-b border-border",
	children: [{
		type: "button",
		classes: `flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-medium text-foreground outline-none ${FOCUS}`,
		children: [words(question), icon("chevron-down", "size-4 shrink-0 text-muted-foreground")],
		interactions: [{
			interaction: "open",
			trigger: "click",
			target: key,
			group: "accordion"
		}]
	}, {
		type: "div",
		key,
		content: answer,
		classes: "hidden pb-4 text-sm text-muted-foreground"
	}]
});
/**
* Tabs, without a default-state trigger.
*
* Panel 1 is visible in the markup and panels 2..N start `hidden`, so the
* component reads correctly with no JS at all. An `appear` binding would have
* been the obvious way to set the default, and it is wrong here: the published
* runtime forces every appear state on after 3s, which would snap the reader
* back to tab 1 mid-read.
*
* So tab 1 is the "off" position of every effect, and tabs 2..N turn theirs on:
*   tab k≥2 → Show@Pk on (grouped, so the other panels close) + Hide@P1 on
*   tab 1   → Hide@P1 off + Show@Pk off for every k
* with the same shape again for the active-tab highlight.
*
* Adding a fourth tab means wiring its bindings by hand — the accepted limit
* of expressing this in a class-toggle model.
*/
var TAB_KEYS = [
	"panel-1",
	"panel-2",
	"panel-3"
];
var TAB_LABELS = [
	"Overview",
	"Details",
	"Activity"
];
var TAB_BODIES = [
	"The first panel is the one visible before anything is clicked.",
	"The second panel. Clicking its tab hides the others.",
	"The third panel, same again."
];
var TAB_BASE = `flex-1 rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-colors ${FOCUS}`;
var tabsRoot = () => {
	const tabs = TAB_LABELS.map((label, i) => {
		const key = `tab-${i + 1}`;
		const first = i === 0;
		return {
			type: "button",
			key,
			children: [words(label)],
			classes: first ? `${TAB_BASE} bg-background text-foreground` : `${TAB_BASE} text-muted-foreground`,
			interactions: first ? [
				{
					interaction: "hide-first",
					trigger: "click",
					target: TAB_KEYS[0],
					action: "off"
				},
				...TAB_KEYS.slice(1).map((k) => ({
					interaction: "show",
					trigger: "click",
					target: k,
					action: "off"
				})),
				{
					interaction: "dim-first",
					trigger: "click",
					target: "tab-1",
					action: "off"
				},
				...TAB_LABELS.slice(1).map((_, j) => ({
					interaction: "activate",
					trigger: "click",
					target: `tab-${j + 2}`,
					action: "off"
				}))
			] : [
				{
					interaction: "show",
					trigger: "click",
					target: TAB_KEYS[i],
					action: "on",
					group: "panels"
				},
				{
					interaction: "hide-first",
					trigger: "click",
					target: TAB_KEYS[0],
					action: "on"
				},
				{
					interaction: "activate",
					trigger: "click",
					target: key,
					action: "on",
					group: "tabs"
				},
				{
					interaction: "dim-first",
					trigger: "click",
					target: "tab-1",
					action: "on"
				}
			]
		};
	});
	const panels = TAB_KEYS.map((key, i) => ({
		type: "div",
		key,
		content: TAB_BODIES[i],
		classes: i === 0 ? "py-4 text-sm text-muted-foreground" : "hidden py-4 text-sm text-muted-foreground"
	}));
	return {
		type: "div",
		classes: "flex w-full flex-col",
		children: [{
			type: "div",
			classes: "flex items-center gap-1 rounded-lg bg-muted p-1",
			children: tabs
		}, ...panels]
	};
};
/** a modal: a trigger, and a layer over the page holding an overlay and a panel */
var modal = (opts) => ({
	type: "div",
	classes: "flex flex-col items-start gap-4",
	children: [trigger(button(opts.open), [{
		interaction: "open",
		trigger: "click",
		target: "layer",
		action: "on"
	}]), {
		type: "div",
		key: "layer",
		classes: "hidden fixed inset-0 z-50 items-center justify-center p-6",
		children: [{
			type: "div",
			classes: OVERLAY,
			...opts.dismissible ? { interactions: [{
				interaction: "open",
				trigger: "click",
				target: "layer",
				action: "off"
			}] } : {}
		}, {
			type: "div",
			classes: DIALOG_PANEL,
			attributes: {
				role: opts.dismissible ? "dialog" : "alertdialog",
				"aria-modal": "true"
			},
			children: [
				{
					type: "h3",
					key: "title",
					content: opts.title,
					classes: "text-lg font-semibold tracking-tight text-card-foreground"
				},
				{
					type: "paragraph",
					key: "description",
					content: opts.body,
					classes: "text-sm text-muted-foreground"
				},
				{
					type: "div",
					classes: "flex items-center justify-end gap-2",
					children: opts.actions
				}
			]
		}]
	}]
});
/** an action inside a modal: it answers, and the modal closes */
var closes = (child, escape = false) => trigger(child, [{
	interaction: "open",
	trigger: "click",
	target: "layer",
	action: "off",
	...escape ? { closeOn: ["escape"] } : {}
}]);
var INTERACTIVE = [
	{
		key: "accordion",
		name: "Accordion",
		category: "Interactive",
		description: "Question rows that open one at a time.",
		tokens: [
			"border",
			"foreground",
			"muted-foreground",
			"ring"
		],
		interactions: [{
			key: "open",
			name: "Accordion · open",
			toClasses: "block"
		}],
		root: {
			type: "div",
			classes: "flex w-full flex-col",
			children: [
				accordionItem("answer-1", "Is it accessible?", "Yes — it is keyboard operable throughout."),
				accordionItem("answer-2", "Can I restyle it?", "Every part is a normal element you can style."),
				accordionItem("answer-3", "Does it work on mobile?", "It does; the rows stack at any width.")
			]
		}
	},
	{
		key: "collapsible",
		name: "Collapsible",
		category: "Interactive",
		description: "One section that opens and closes.",
		tokens: [
			"border",
			"foreground",
			"muted-foreground"
		],
		interactions: [{
			key: "open",
			name: "Collapsible · open",
			toClasses: "flex"
		}],
		root: {
			type: "div",
			classes: "flex w-full flex-col gap-2",
			children: [{
				type: "div",
				classes: "flex items-center justify-between gap-4",
				children: [{
					type: "span",
					key: "title",
					content: "Three more items",
					classes: "text-sm font-medium text-foreground"
				}, trigger(button("Toggle", {
					variant: "ghost",
					size: "icon",
					start: "chevrons-up-down",
					iconOnly: true
				}), [{
					interaction: "open",
					trigger: "click",
					target: "content"
				}])]
			}, {
				type: "div",
				key: "content",
				classes: "hidden flex-col gap-2",
				children: [
					{
						type: "text",
						content: "First item",
						classes: "rounded-md border border-border px-4 py-2 text-sm text-muted-foreground"
					},
					{
						type: "text",
						content: "Second item",
						classes: "rounded-md border border-border px-4 py-2 text-sm text-muted-foreground"
					},
					{
						type: "text",
						content: "Third item",
						classes: "rounded-md border border-border px-4 py-2 text-sm text-muted-foreground"
					}
				]
			}]
		}
	},
	{
		key: "dialog",
		name: "Dialog",
		category: "Interactive",
		description: "A modal over a dimmed page. The overlay and Escape dismiss it.",
		tokens: [
			"border",
			"card",
			"card-foreground",
			"muted-foreground"
		],
		interactions: [{
			key: "open",
			name: "Dialog · open",
			toClasses: "flex"
		}],
		root: modal({
			open: "Open dialog",
			title: "Edit profile",
			body: "Make your changes here, then save when you are done.",
			dismissible: true,
			actions: [closes(button("Cancel", { variant: "outline" }), true), closes(button("Save changes"))]
		})
	},
	{
		key: "alert-dialog",
		name: "AlertDialog",
		category: "Interactive",
		description: "A modal that wants an answer: only its buttons close it.",
		tokens: [
			"border",
			"card",
			"card-foreground",
			"muted-foreground"
		],
		interactions: [{
			key: "open",
			name: "Alert dialog · open",
			toClasses: "flex"
		}],
		root: modal({
			open: "Delete account",
			title: "Are you sure?",
			body: "This action cannot be undone.",
			dismissible: false,
			actions: [closes(button("Cancel", { variant: "outline" })), closes(button("Delete", { variant: "destructive" }))]
		})
	},
	{
		key: "sheet",
		name: "Sheet",
		category: "Interactive",
		description: "A panel that comes in from an edge of the screen.",
		tokens: [
			"border",
			"background",
			"foreground",
			"muted-foreground"
		],
		variants: [{
			name: "side",
			options: [
				"right",
				"left",
				"top",
				"bottom"
			],
			default: "right"
		}],
		interactions: [{
			key: "open",
			name: "Sheet · open",
			toClasses: "visible opacity-100"
		}, {
			key: "slide",
			name: "Sheet · slide in",
			toClasses: "translate-x-0 translate-y-0"
		}],
		root: {
			type: "div",
			classes: "flex flex-col items-start gap-4",
			children: [trigger(button("Open sheet", { variant: "outline" }), [{
				interaction: "open",
				trigger: "click",
				target: "layer",
				action: "on"
			}, {
				interaction: "slide",
				trigger: "click",
				target: "panel",
				action: "on"
			}]), {
				type: "div",
				key: "layer",
				classes: FADE_LAYER,
				children: [{
					type: "div",
					classes: OVERLAY,
					interactions: [{
						interaction: "open",
						trigger: "click",
						target: "layer",
						action: "off",
						closeOn: ["escape"]
					}, {
						interaction: "slide",
						trigger: "click",
						target: "panel",
						action: "off"
					}]
				}, {
					type: "div",
					key: "panel",
					classes: "absolute inset-y-0 right-0 flex h-full w-80 translate-x-full flex-col gap-4 border-l border-border bg-background p-6 shadow-lg transition-transform",
					variantClasses: {
						"side:left": "right-auto left-0 -translate-x-full border-l-0 border-r",
						"side:top": "inset-x-0 inset-y-auto top-0 h-auto w-full -translate-y-full border-l-0 border-b",
						"side:bottom": "inset-x-0 inset-y-auto bottom-0 h-auto w-full translate-y-full border-l-0 border-t"
					},
					attributes: {
						role: "dialog",
						"aria-modal": "true"
					},
					children: [
						{
							type: "h3",
							key: "title",
							content: "Sheet title",
							classes: "text-lg font-semibold tracking-tight text-foreground"
						},
						{
							type: "paragraph",
							key: "description",
							content: "What this panel is for, in a line.",
							classes: "text-sm text-muted-foreground"
						},
						trigger(button("Close", { variant: "outline" }), [{
							interaction: "open",
							trigger: "click",
							target: "layer",
							action: "off"
						}, {
							interaction: "slide",
							trigger: "click",
							target: "panel",
							action: "off"
						}])
					]
				}]
			}]
		}
	},
	{
		key: "dropdown-menu",
		name: "DropdownMenu",
		category: "Interactive",
		description: "A button that opens a menu, dismissed by clicking away or Escape.",
		tokens: [
			"accent",
			"accent-foreground",
			"border",
			"card",
			"card-foreground"
		],
		interactions: [{
			key: "open",
			name: "Dropdown · open",
			toClasses: "flex"
		}],
		root: {
			type: "div",
			classes: "relative inline-flex",
			children: [trigger(button("Options", {
				variant: "outline",
				end: "chevron-down"
			}), [{
				interaction: "open",
				trigger: "click",
				target: "menu",
				closeOn: ["outside", "escape"]
			}]), {
				type: "div",
				key: "menu",
				classes: `hidden absolute left-0 top-[100%] z-50 mt-2 w-44 flex-col p-1 ${SURFACE}`,
				attributes: { role: "menu" },
				children: [
					link("Profile", "/", MENU_ITEM),
					link("Settings", "/", MENU_ITEM),
					link("Sign out", "/", MENU_ITEM)
				]
			}]
		}
	},
	{
		key: "popover",
		name: "Popover",
		category: "Interactive",
		description: "A small panel anchored to the button that opens it.",
		tokens: [
			"border",
			"card",
			"card-foreground",
			"muted-foreground"
		],
		interactions: [{
			key: "open",
			name: "Popover · open",
			toClasses: "flex"
		}],
		root: {
			type: "div",
			classes: "relative inline-flex",
			children: [trigger(button("Open popover", { variant: "outline" }), [{
				interaction: "open",
				trigger: "click",
				target: "panel",
				closeOn: ["outside", "escape"]
			}]), {
				type: "div",
				key: "panel",
				classes: `hidden absolute left-0 top-[100%] z-50 mt-2 w-72 flex-col gap-1 p-4 ${SURFACE}`,
				children: [{
					type: "h4",
					key: "title",
					content: "Dimensions",
					classes: "text-sm font-medium text-card-foreground"
				}, {
					type: "paragraph",
					key: "description",
					content: "Set the dimensions for the layer.",
					classes: "text-sm text-muted-foreground"
				}]
			}]
		}
	},
	{
		key: "tooltip",
		name: "Tooltip",
		category: "Interactive",
		description: "A word of explanation, on hover or focus.",
		tokens: ["foreground", "background"],
		root: {
			type: "div",
			classes: "group relative inline-flex",
			children: [button("Hover me", { variant: "outline" }), {
				type: "span",
				key: "label",
				content: "Add to library",
				classes: "pointer-events-none absolute bottom-[100%] left-[50%] z-50 mb-2 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
				attributes: { role: "tooltip" }
			}]
		}
	},
	{
		key: "hover-card",
		name: "HoverCard",
		category: "Interactive",
		description: "A preview of what a link leads to, on hover.",
		tokens: [
			"primary",
			"border",
			"card",
			"card-foreground",
			"muted-foreground"
		],
		root: {
			type: "div",
			classes: "group relative inline-flex",
			children: [link("@acme", "/", "text-sm font-medium text-primary underline-offset-4 hover:underline"), {
				type: "div",
				key: "card",
				classes: `pointer-events-none absolute left-0 top-[100%] z-50 mt-2 flex w-64 flex-col gap-1 p-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${SURFACE}`,
				children: [{
					type: "span",
					key: "name",
					content: "Acme Inc.",
					classes: "text-sm font-semibold text-card-foreground"
				}, {
					type: "paragraph",
					key: "description",
					content: "Tools for people who build for the web.",
					classes: "text-sm text-muted-foreground"
				}]
			}]
		}
	},
	{
		key: "navbar",
		name: "Navbar",
		category: "Navigation",
		description: "A sticky header whose links collapse into a menu on mobile.",
		tokens: [
			"border",
			"background",
			"foreground",
			"muted-foreground",
			"accent",
			"accent-foreground"
		],
		interactions: [{
			key: "open",
			name: "Navbar · open menu",
			toClasses: "flex"
		}],
		root: {
			type: "header",
			classes: "sticky top-0 z-50 flex items-center justify-between border-b border-border bg-background px-6 py-3",
			children: [
				link("Acme", "/", "text-base font-semibold text-foreground"),
				{
					type: "nav",
					classes: "hidden items-center gap-6 md:flex",
					children: [
						link("Home", "/", NAVBAR_LINK),
						link("Features", "/features", NAVBAR_LINK),
						link("Pricing", "/pricing", NAVBAR_LINK)
					]
				},
				trigger(button("Menu", {
					variant: "outline",
					size: "icon",
					start: "menu",
					iconOnly: true
				}), [{
					interaction: "open",
					trigger: "click",
					target: "mobile-menu",
					closeOn: ["outside", "escape"]
				}], "flex md:hidden"),
				{
					type: "nav",
					key: "mobile-menu",
					classes: "hidden absolute left-0 top-[100%] z-50 w-full flex-col gap-1 border-b border-border bg-background p-4 md:hidden",
					children: [
						link("Home", "/", MOBILE_LINK),
						link("Features", "/features", MOBILE_LINK),
						link("Pricing", "/pricing", MOBILE_LINK)
					]
				}
			]
		}
	},
	{
		key: "tabs",
		name: "Tabs",
		category: "Interactive",
		description: "Three panels behind three tabs. The first is open by default.",
		tokens: [
			"muted",
			"muted-foreground",
			"background",
			"foreground",
			"ring"
		],
		interactions: [
			{
				key: "show",
				name: "Tabs · show panel",
				toClasses: "block"
			},
			{
				key: "hide-first",
				name: "Tabs · hide first panel",
				toClasses: "hidden"
			},
			{
				key: "activate",
				name: "Tabs · active tab",
				toClasses: "bg-background text-foreground"
			},
			{
				key: "dim-first",
				name: "Tabs · inactive first tab",
				toClasses: "bg-muted text-muted-foreground"
			}
		],
		root: tabsRoot()
	}
];
//#endregion
//#region src/lib/catalog/tokens.ts
/**
* The semantic palette the bundled library is built on — the shadcn set, with
* neutral light-theme defaults.
*
* Adding an entry creates only the tokens it actually names, and never touches
* one that already exists: the point is that a project restyles the whole
* library from Settings → Design tokens, so the user's value always wins.
*
* Design tokens are hex colours only. Radii, spacing and type scale live in
* `settings.theme`, so the entries spell those as ordinary Tailwind classes.
*/
var CATALOG_TOKENS = {
	background: "#ffffff",
	foreground: "#0a0a0a",
	card: "#ffffff",
	"card-foreground": "#0a0a0a",
	primary: "#171717",
	"primary-foreground": "#fafafa",
	secondary: "#f5f5f5",
	"secondary-foreground": "#171717",
	muted: "#f5f5f5",
	"muted-foreground": "#737373",
	accent: "#f5f5f5",
	"accent-foreground": "#171717",
	destructive: "#e7000b",
	"destructive-foreground": "#ffffff",
	border: "#e5e5e5",
	input: "#e5e5e5",
	ring: "#a1a1a1"
};
//#endregion
//#region src/lib/catalog/icons.ts
var CATALOG_ICONS = {
	"arrow-left": "<path d=\"m12 19-7-7 7-7\"/><path d=\"M19 12H5\"/>",
	"arrow-right": "<path d=\"M5 12h14\"/><path d=\"m12 5 7 7-7 7\"/>",
	"bold": "<path d=\"M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8\"/>",
	"check": "<path d=\"M20 6 9 17l-5-5\"/>",
	"chevron-down": "<path d=\"m6 9 6 6 6-6\"/>",
	"chevron-left": "<path d=\"m15 18-6-6 6-6\"/>",
	"chevron-right": "<path d=\"m9 18 6-6-6-6\"/>",
	"chevrons-up-down": "<path d=\"m7 15 5 5 5-5\"/><path d=\"m7 9 5-5 5 5\"/>",
	"inbox": "<polyline points=\"22 12 16 12 14 15 10 15 8 12 2 12\"/><path d=\"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z\"/>",
	"info": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 16v-4\"/><path d=\"M12 8h.01\"/>",
	"loader-circle": "<path d=\"M21 12a9 9 0 1 1-6.219-8.56\"/>",
	"menu": "<path d=\"M4 5h16\"/><path d=\"M4 12h16\"/><path d=\"M4 19h16\"/>",
	"plus": "<path d=\"M5 12h14\"/><path d=\"M12 5v14\"/>",
	"text-align-center": "<path d=\"M21 5H3\"/><path d=\"M17 12H7\"/><path d=\"M19 19H5\"/>",
	"text-align-end": "<path d=\"M21 5H3\"/><path d=\"M21 12H9\"/><path d=\"M21 19H7\"/>",
	"text-align-start": "<path d=\"M21 5H3\"/><path d=\"M15 12H3\"/><path d=\"M17 19H3\"/>",
	"zap": "<path d=\"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z\"/>"
};
//#endregion
//#region src/lib/catalog/materialize.ts
var iconMarkup = (name) => CATALOG_ICONS[name] ? lucideSvg(name, CATALOG_ICONS[name]) : "";
/** where each keyed node of an entry sits, as child indexes from its root */
function keyPaths(entry) {
	const paths = /* @__PURE__ */ new Map();
	const visit = (node, path) => {
		if (node.key) paths.set(node.key, path);
		if (!node.component) (node.children ?? []).forEach((child, i) => visit(child, [...path, i]));
	};
	visit(entry.root, []);
	return paths;
}
var DEFAULT_DURATION = "duration-200";
var DEFAULT_EASING = "ease-out";
/**
* Turns a bundled library entry into a real, independent `ComponentDef` for
* this project — fresh ids throughout, symbolic targets resolved, and the
* shared library entries it needs alongside it.
*
* Nothing links back to the catalog afterwards: `source` only records where it
* came from, so the Library can show which entries are already added.
*/
function materialize(entry, project, context) {
	const name = normalizeComponentName(entry.name, project.components.map((c) => c.name));
	const newInteractions = [];
	const interactionIds = /* @__PURE__ */ new Map();
	for (const spec of entry.interactions ?? []) {
		const shape = {
			name: spec.name,
			toClasses: spec.toClasses,
			duration: spec.duration ?? DEFAULT_DURATION,
			easing: spec.easing ?? DEFAULT_EASING
		};
		const existing = project.interactions.find((i) => i.name === shape.name && i.toClasses === shape.toClasses && i.duration === shape.duration && i.easing === shape.easing);
		if (existing) {
			interactionIds.set(spec.key, existing.id);
			continue;
		}
		const made = {
			id: crypto.randomUUID(),
			...shape
		};
		newInteractions.push(made);
		interactionIds.set(spec.key, made.id);
	}
	const keyToId = /* @__PURE__ */ new Map();
	const dependencies = {};
	const pending = [];
	/** an instance of another entry: a mirror of that component, carrying what
	*  this entry says about it */
	const instance = (source) => {
		const inner = context.component(source.component);
		if (!inner) throw new Error(`"${entry.key}" holds "${source.component}", which could not be resolved`);
		dependencies[source.component] = inner.name;
		const node = createMirror(inner.root);
		for (const [axis, option] of Object.entries(source.variants ?? {})) setInstancePick(inner, node, axis, option);
		if (source.hidden) node.hidden = true;
		const held = context.entry(source.component);
		const paths = held ? keyPaths(held) : /* @__PURE__ */ new Map();
		for (const [key, part] of Object.entries(source.parts ?? {})) {
			const path = paths.get(key);
			if (!path) continue;
			let at = node.children[0];
			for (const i of path) at = at?.children[i];
			if (!at) continue;
			if (part.content !== void 0) at.content = part.content;
			if (part.hidden !== void 0) at.hidden = part.hidden;
			if (part.icon && at.type === "icon") {
				const svg = iconMarkup(part.icon);
				if (svg) at.svg = svg;
			}
		}
		if (source.key) keyToId.set(source.key, node.id);
		return node;
	};
	const build = (source) => {
		if (source.component) return instance(source);
		const node = {
			id: crypto.randomUUID(),
			type: source.type,
			content: source.content ?? "",
			children: (source.children ?? []).map(build)
		};
		if (source.classes) node.classes = source.classes;
		if (source.link) node.link = source.link;
		if (source.attributes) node.attributes = { ...source.attributes };
		if (source.src) node.src = source.src;
		if (source.hidden) node.hidden = true;
		if (source.icon) {
			const svg = iconMarkup(source.icon);
			if (svg) node.svg = svg;
		}
		if (source.slider) node.slider = JSON.parse(JSON.stringify(source.slider));
		if (source.variantClasses && Object.keys(source.variantClasses).length) {
			const kept = {};
			for (const axis of entry.variants ?? []) for (const option of axis.options) {
				const classes = source.variantClasses[`${axis.name}:${option}`];
				if (classes) kept[`${axis.name}:${option}`] = classes;
			}
			if (Object.keys(kept).length) node.variantClasses = kept;
		}
		if (source.key) keyToId.set(source.key, node.id);
		if (source.interactions?.length) pending.push({
			node,
			source
		});
		return node;
	};
	const child = build(entry.root);
	for (const { node, source } of pending) {
		const bindings = [];
		for (const b of source.interactions ?? []) {
			const interactionId = interactionIds.get(b.interaction);
			if (!interactionId) continue;
			const binding = {
				id: crypto.randomUUID(),
				interactionId,
				trigger: b.trigger,
				targetId: b.target ? keyToId.get(b.target) ?? null : null
			};
			if (b.action) binding.action = b.action;
			if (b.closeOn?.length) binding.closeOn = [...b.closeOn];
			if (b.group) binding.group = b.group;
			if (b.once) binding.once = b.once;
			bindings.push(binding);
		}
		if (bindings.length) node.interactions = bindings;
	}
	const root = {
		id: crypto.randomUUID(),
		type: name,
		content: "",
		children: [child]
	};
	const def = {
		id: crypto.randomUUID(),
		name,
		root
	};
	setComponentMeta(def, {
		category: entry.category,
		source: entry.key,
		variants: entry.variants
	});
	const have = new Set(project.settings.tokens.map((t) => t.name));
	return {
		def,
		interactions: newInteractions,
		tokens: entry.tokens.filter((n) => !have.has(n) && CATALOG_TOKENS[n]).map((n) => ({
			id: crypto.randomUUID(),
			name: n,
			value: CATALOG_TOKENS[n]
		})),
		...Object.keys(dependencies).length ? { dependencies } : {}
	};
}
//#endregion
//#region src/lib/catalog/index.ts
/**
* The bundled component library — ready-made pieces the user COPIES into a
* project. Once added, a component is ordinary: nothing follows the catalog,
* so editing or deleting it has no effect here and a library update never
* reaches a project that already added the entry.
*
* Ships with the app rather than being fetched, so it works offline and is
* versioned with the editor that renders it.
*/
var CATALOG = [
	...PRIMITIVES,
	...FORMS,
	...CONTENT,
	...INTERACTIVE
];
function catalogEntry(key) {
	return CATALOG.find((e) => e.key === key) ?? null;
}
/** the entries an entry holds an instance of, directly — by key, each once */
function catalogDependencies(entry) {
	const keys = /* @__PURE__ */ new Set();
	const visit = (node) => {
		if (node.component) keys.add(node.component);
		else (node.children ?? []).forEach(visit);
	};
	visit(entry.root);
	return [...keys];
}
/**
* Turn a library entry into a component for this project.
*
* An entry may hold instances of other entries (a Card holds a Button).
* `component` says what each of those resolves to; by default, the component
* the project already made from that entry. A caller that can ADD the missing
* one — or stand a preview in for it — passes its own.
*/
function materializeCatalogEntry(entry, project, component = (key) => project.components.find((c) => c.source === key) ?? null) {
	return materialize(entry, project, {
		component,
		entry: catalogEntry
	});
}
//#endregion
export { APPEAR_MODES, BUILTIN_LIST_SOURCES, CATALOG, CATALOG_TOKENS, DEFAULT_SCROLL_AT, EASINGS, EASING_KEYS, ELEMENTS, ELIDED_DATA_URL, FONT_FORMATS, HEX_RE, INTERACTION_ACTIONS, INTERACTION_CLOSE_ON, INTERACTION_ONCE, INTERACTION_TRIGGERS, MAX_DEPTH, MAX_INPUT, MOTION_PROPS, NODE_STATE_KEYS, RESERVED_TOKEN_NAMES, SAFE_HREF, SAFE_SRC, SCHEMA_VERSION, SCROLL_LERP_MAX, SCROLL_LERP_MIN, SLIDER_DEFAULTS, STYLE_SECTIONS, TOKEN_NAME_RE, TRANSITION_DEFAULTS, TRANSITION_PRESET_IDS, VARIANT_NAME_RE, addVariantAxis, addVariantOption, adoptStructure, alignMirrors, alignStructure, applyClass, applyHtml, buildInstanceMap, buildScopeRoots, canNest, catalogDependencies, catalogEntry, cloneForMaster, collectFormFields, compileAnimation, componentReaches, componentUsage, contextFromProject, countLocaleSeo, createBody, createNode, createPage, createProject, customSchemaError, deepClone, defaultBreakpoints, defaultSettings, deleteComponent, dependencyOrder, describeMigration, detachInstance, duplicateComponent, effectiveClasses, findNode, findParent, fontError, fontFormatForUrl, formConfigError, formEnabled, formName, hasAncestorOfType, hasNodeState, inheritedInstanceValue, interactionGroupKey, interactionStateKey, isAllowedAttribute, isComponentType, isEmittableToken, isEntryScopeRoot, isInstanceWrapper, isKnownElement, isLeafElement, isLocalizableAttribute, isNodeHidden, isReservedToken, isRich, isStateClass, isSymmetricTrigger, isThemeValue, isValidClass, isValidToken, lucideNameOf, lucideSvg, masterToHtml, matchClass, materializeCatalogEntry, mergeAttributeLayers, mergeClassLayers, migrateProject, nestedComponentNames, nodesByShortId, normalizeComponentName, pageToHtml, parseHtml, pickedKeys, purgeLocaleSeo, pushMasterStructure, removeVariantAxis, removeVariantOption, renameComponent, renameVariantAxis, renameVariantOption, resolveInstanceValue, resolvePicks, resolveSliderConfig, sameLayerProperty, sameProperty, sameType, sanitizeAttributes, sanitizeInlineSvg, sanitizeRich, setComponentCategory, setComponentMeta, setInstancePick, setNodeHidden, setStyleTokens, setVariantAxes, setVariantClasses, setVariantDefault, shortIds, slugify, stripExtractedInstanceState, stripNodeState, tagForType, tokenError, typeForTag, typeOptionsFor, validateAnimation, validateBinding, validateMotionSettings, validateSliderConfig, validateTree, variantKey, walkNodes };
