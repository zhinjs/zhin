import { addClassToHast } from 'shikiji';

function separateContinuousSpaces(inputs) {
  const result = [];
  let current = "";
  function bump() {
    if (current.length)
      result.push(current);
    current = "";
  }
  inputs.forEach((part, idx) => {
    if (isTab(part)) {
      bump();
      result.push(part);
    } else if (isSpace(part) && (isSpace(inputs[idx - 1]) || isSpace(inputs[idx + 1]))) {
      bump();
      result.push(part);
    } else {
      current += part;
    }
  });
  bump();
  return result;
}
function isTab(part) {
  return part === "	";
}
function isSpace(part) {
  return part === " " || part === "	";
}
function splitSpaces(parts, type, renderContinuousSpaces = true) {
  if (type === "all")
    return parts;
  let leftCount = 0;
  let rightCount = 0;
  if (type === "boundary") {
    for (let i = 0; i < parts.length; i++) {
      if (isSpace(parts[i]))
        leftCount++;
      else
        break;
    }
  }
  if (type === "boundary" || type === "trailing") {
    for (let i = parts.length - 1; i >= 0; i--) {
      if (isSpace(parts[i]))
        rightCount++;
      else
        break;
    }
  }
  const middle = parts.slice(leftCount, parts.length - rightCount);
  return [
    ...parts.slice(0, leftCount),
    ...renderContinuousSpaces ? separateContinuousSpaces(middle) : [middle.join("")],
    ...parts.slice(parts.length - rightCount)
  ];
}

function transformerRenderWhitespace(options = {}) {
  const classMap = {
    " ": options.classSpace ?? "space",
    "	": options.classTab ?? "tab"
  };
  const position = options.position ?? "all";
  const keys = Object.keys(classMap);
  return {
    name: "shikiji-transformers:render-whitespace",
    // We use `root` hook here to ensure it runs after all other transformers
    root(root) {
      const pre = root.children[0];
      const code = pre.children[0];
      code.children.forEach(
        (line) => {
          if (line.type !== "element")
            return;
          const elements = line.children.filter((token) => token.type === "element");
          const last = elements.length - 1;
          line.children = line.children.flatMap((token) => {
            if (token.type !== "element")
              return token;
            const index = elements.indexOf(token);
            if (position === "boundary" && index !== 0 && index !== last)
              return token;
            if (position === "trailing" && index !== last)
              return token;
            const node = token.children[0];
            if (node.type !== "text" || !node.value)
              return token;
            const parts = splitSpaces(
              node.value.split(/([ \t])/).filter((i) => i.length),
              position === "boundary" && index === last && last !== 0 ? "trailing" : position,
              position !== "trailing"
            );
            if (parts.length <= 1)
              return token;
            return parts.map((part) => {
              const clone = {
                ...token,
                properties: { ...token.properties }
              };
              clone.children = [{ type: "text", value: part }];
              if (keys.includes(part)) {
                addClassToHast(clone, classMap[part]);
                delete clone.properties.style;
              }
              return clone;
            });
          });
        }
      );
    }
  };
}

function transformerRemoveLineBreak() {
  return {
    name: "shikiji-transformers:remove-line-break",
    code(code) {
      code.children = code.children.filter((line) => !(line.type === "text" && line.value === "\n"));
    }
  };
}

function transformerCompactLineOptions(lineOptions = []) {
  return {
    name: "shikiji-transformers:compact-line-options",
    line(node, line) {
      const lineOption = lineOptions.find((o) => o.line === line);
      if (lineOption?.classes)
        addClassToHast(node, lineOption.classes);
      return node;
    }
  };
}

function createCommentNotationTransformer(name, regex, onMatch) {
  return {
    name,
    code(code) {
      const lines = code.children.filter((i) => i.type === "element");
      lines.forEach((line, idx) => {
        let nodeToRemove;
        for (const child of line.children) {
          if (child.type !== "element")
            continue;
          const text = child.children[0];
          if (text.type !== "text")
            continue;
          let replaced = false;
          text.value = text.value.replace(regex, (...match) => {
            if (onMatch.call(this, match, line, child, lines, idx)) {
              replaced = true;
              return "";
            }
            return match[0];
          });
          if (replaced && !text.value.trim())
            nodeToRemove = child;
        }
        if (nodeToRemove)
          line.children.splice(line.children.indexOf(nodeToRemove), 1);
      });
    }
  };
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function transformerNotationMap(options = {}, name = "shikiji-transformers:notation-map") {
  const {
    classMap = {},
    classActivePre = void 0
  } = options;
  return createCommentNotationTransformer(
    name,
    new RegExp(`\\s*(?://|/\\*|<!--|#)\\s+\\[!code (${Object.keys(classMap).map(escapeRegExp).join("|")})(:\\d+)?\\]\\s*(?:\\*/|-->)?`),
    function([_, match, range = ":1"], _line, _comment, lines, index) {
      const lineNum = Number.parseInt(range.slice(1), 10);
      lines.slice(index, index + lineNum).forEach((line) => {
        addClassToHast(line, classMap[match]);
      });
      if (classActivePre)
        addClassToHast(this.pre, classActivePre);
      return true;
    }
  );
}

function transformerNotationFocus(options = {}) {
  const {
    classActiveLine = "focused",
    classActivePre = "has-focused"
  } = options;
  return transformerNotationMap(
    {
      classMap: {
        focus: classActiveLine
      },
      classActivePre
    },
    "shikiji-transformers:notation-focus"
  );
}

function transformerNotationHighlight(options = {}) {
  const {
    classActiveLine = "highlighted",
    classActivePre = "has-highlighted"
  } = options;
  return transformerNotationMap(
    {
      classMap: {
        highlight: classActiveLine,
        hl: classActiveLine
      },
      classActivePre
    },
    "shikiji-transformers:notation-highlight"
  );
}

function transformerNotationDiff(options = {}) {
  const {
    classLineAdd = "diff add",
    classLineRemove = "diff remove",
    classActivePre = "has-diff"
  } = options;
  return transformerNotationMap(
    {
      classMap: {
        "++": classLineAdd,
        "--": classLineRemove
      },
      classActivePre
    },
    "shikiji-transformers:notation-diff"
  );
}

function transformerNotationErrorLevel(options = {}) {
  const {
    classMap = {
      error: ["highlighted", "error"],
      warning: ["highlighted", "warning"]
    },
    classActivePre = "has-highlighted"
  } = options;
  return transformerNotationMap(
    {
      classMap,
      classActivePre
    },
    "shikiji-transformers:notation-error-level"
  );
}

export { createCommentNotationTransformer, transformerCompactLineOptions, transformerNotationDiff, transformerNotationErrorLevel, transformerNotationFocus, transformerNotationHighlight, transformerRemoveLineBreak, transformerRenderWhitespace };
