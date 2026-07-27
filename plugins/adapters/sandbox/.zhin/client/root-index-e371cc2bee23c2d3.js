// zhin-virtual:zhin-console-contract-stub
function definePage(metadata = {}) {
  return metadata;
}

// pages/SandboxChat.tsx
import React2, { useState as useState3, useEffect as useEffect3, useRef as useRef3 } from "/esm/react.mjs?v=ms2oc1s3";

// ../../../packages/console/protocol/lib/index.js
var SIDE_EVENT_PUSH = {
  NOTICE_RECEIVE: "notice.receive",
  REQUEST_RECEIVE: "request.receive",
  MESSAGE_RECEIVE: "message.receive",
  ENDPOINT_LIFECYCLE: "endpoint.lifecycle"
};
var SIDE_EVENT_RPC = {
  REQUEST_LIST: "request.list",
  REQUEST_APPROVE: "request.approve",
  REQUEST_REJECT: "request.reject",
  REQUEST_CONSUMED: "request.consumed",
  NOTICE_CONSUMED: "notice.consumed"
};
var INBOX_RPC = {
  MESSAGES: "inbox.messages",
  REQUESTS: "inbox.requests",
  NOTICES: "inbox.notices"
};
var ENDPOINT_RPC = {
  LIST: "endpoint.list",
  INFO: "endpoint.info",
  SEND_MESSAGE: "endpoint.send_message",
  FRIENDS: "endpoint.friends",
  GROUPS: "endpoint.groups",
  CHANNELS: "endpoint.channels",
  DELETE_FRIEND: "endpoint.delete_friend",
  GROUP_MEMBERS: "endpoint.group_members",
  GROUP_KICK: "endpoint.group_kick",
  GROUP_MUTE: "endpoint.group_mute",
  GROUP_ADMIN: "endpoint.group_admin"
};
var SIDE_EVENT_NAMES = {
  ...SIDE_EVENT_PUSH,
  ...SIDE_EVENT_RPC,
  ...INBOX_RPC,
  ...ENDPOINT_RPC
};
var PUSH_TYPE_ALIASES = Object.freeze({
  "endpoint:message": SIDE_EVENT_PUSH.MESSAGE_RECEIVE,
  "endpoint:request": SIDE_EVENT_PUSH.REQUEST_RECEIVE,
  "endpoint:notice": SIDE_EVENT_PUSH.NOTICE_RECEIVE,
  "endpoint:lifecycle": SIDE_EVENT_PUSH.ENDPOINT_LIFECYCLE
});
var RPC_TYPE_ALIASES = Object.freeze({
  "endpoint:list": ENDPOINT_RPC.LIST,
  "endpoint:info": ENDPOINT_RPC.INFO,
  "endpoint:sendMessage": ENDPOINT_RPC.SEND_MESSAGE,
  "endpoint:friends": ENDPOINT_RPC.FRIENDS,
  "endpoint:groups": ENDPOINT_RPC.GROUPS,
  "endpoint:channels": ENDPOINT_RPC.CHANNELS,
  "endpoint:deleteFriend": ENDPOINT_RPC.DELETE_FRIEND,
  "endpoint:groupMembers": ENDPOINT_RPC.GROUP_MEMBERS,
  "endpoint:groupKick": ENDPOINT_RPC.GROUP_KICK,
  "endpoint:groupMute": ENDPOINT_RPC.GROUP_MUTE,
  "endpoint:groupAdmin": ENDPOINT_RPC.GROUP_ADMIN,
  "endpoint:requests": SIDE_EVENT_RPC.REQUEST_LIST,
  "endpoint:requestApprove": SIDE_EVENT_RPC.REQUEST_APPROVE,
  "endpoint:requestReject": SIDE_EVENT_RPC.REQUEST_REJECT,
  "endpoint:requestConsumed": SIDE_EVENT_RPC.REQUEST_CONSUMED,
  "endpoint:noticeConsumed": SIDE_EVENT_RPC.NOTICE_CONSUMED,
  "endpoint:inboxMessages": INBOX_RPC.MESSAGES,
  "endpoint:inboxRequests": INBOX_RPC.REQUESTS,
  "endpoint:inboxNotices": INBOX_RPC.NOTICES
});
var DEMO_RPC_ALLOWLIST = /* @__PURE__ */ new Set([
  "ping",
  "entries:get",
  "pages:list",
  "config:get",
  "config:get-all",
  "config:get-yaml",
  "schema:get",
  "schema:get-all",
  "schedule:list",
  "cron:list",
  ENDPOINT_RPC.LIST,
  ENDPOINT_RPC.INFO,
  ENDPOINT_RPC.SEND_MESSAGE,
  ENDPOINT_RPC.FRIENDS,
  ENDPOINT_RPC.GROUPS,
  ENDPOINT_RPC.CHANNELS,
  ENDPOINT_RPC.GROUP_MEMBERS,
  SIDE_EVENT_RPC.REQUEST_LIST,
  INBOX_RPC.MESSAGES,
  INBOX_RPC.REQUESTS,
  INBOX_RPC.NOTICES
]);
var DEMO_RPC_WRITE_BLOCKLIST = /* @__PURE__ */ new Set([
  "config:set",
  "config:save-yaml",
  "files:save",
  "env:save",
  "db:insert",
  "db:update",
  "db:delete",
  "db:drop-table",
  "db:kv:set",
  "db:kv:delete",
  "system:restart",
  "schedule:add",
  "schedule:remove",
  "schedule:pause",
  "schedule:resume",
  "cron:add",
  "cron:remove",
  "cron:pause",
  "cron:resume",
  SIDE_EVENT_RPC.REQUEST_APPROVE,
  SIDE_EVENT_RPC.REQUEST_REJECT,
  SIDE_EVENT_RPC.REQUEST_CONSUMED,
  SIDE_EVENT_RPC.NOTICE_CONSUMED,
  ENDPOINT_RPC.GROUP_KICK,
  ENDPOINT_RPC.GROUP_MUTE,
  ENDPOINT_RPC.GROUP_ADMIN,
  ENDPOINT_RPC.DELETE_FRIEND
]);

// ../../../packages/console/client/dist/mediaSrc.js
var BASE64_PROTO = "base64://";
function resolveMediaSrc(raw, kind = "image") {
  if (raw == null || typeof raw !== "string")
    return void 0;
  const s = raw.trim();
  if (!s)
    return void 0;
  if (s.startsWith("data:") || s.startsWith("blob:") || s.startsWith("http://") || s.startsWith("https://")) {
    return s;
  }
  if (!s.startsWith(BASE64_PROTO)) {
    return s;
  }
  const payload = s.slice(BASE64_PROTO.length).replace(/^\s+/, "");
  if (!payload)
    return void 0;
  if (/^[\w+.-]+\/[\w+.-]+;base64,/i.test(payload)) {
    return `data:${payload}`;
  }
  const defaultMime = kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg";
  const b64 = payload.replace(/\s/g, "");
  return `data:${defaultMime};base64,${b64}`;
}
function pickMediaRawUrl(data) {
  if (!data)
    return void 0;
  const media = data.media;
  if (media && typeof media === "object" && media !== null) {
    const value = media.value;
    if (typeof value === "string" && value.trim())
      return value.trim();
  }
  const v = data.url ?? data.file ?? data.src ?? data.href;
  if (typeof v === "string" && v.trim())
    return v.trim();
  const b64 = data.base64;
  if (typeof b64 === "string" && b64.trim()) {
    const payload = b64.trim();
    if (payload.startsWith("data:") || payload.startsWith("base64://") || payload.startsWith("http://") || payload.startsWith("https://")) {
      return payload;
    }
    const mime = typeof data.mime === "string" && data.mime.trim() ? data.mime.trim() : "";
    return mime ? `data:${mime};base64,${payload.replace(/\s/g, "")}` : `base64://${payload}`;
  }
  return void 0;
}

// ../../../packages/console/client/dist/app.js
var listeners = /* @__PURE__ */ new Set();
var version = 0;
function bump() {
  version++;
  for (const l of listeners)
    l();
}
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function getVersion() {
  return version;
}
var routes = [];
var tools = [];
var sidebarRenderer = null;
var toolbarRenderer = null;
var routeRenderer = null;
function slugId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tool";
}
function buildRouteTree(flatRoutes) {
  const nodes = flatRoutes.map((r2) => ({ ...r2, children: [] }));
  const roots = [];
  for (const node of nodes) {
    if (!node.parent) {
      roots.push(node);
    } else {
      const parent = nodes.find((n) => n.path === node.parent);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }
  const sortFn = (a, b) => (a.meta?.order ?? 999) - (b.meta?.order ?? 999);
  roots.sort(sortFn);
  for (const n of nodes)
    n.children.sort(sortFn);
  return roots;
}
function buildToolTree(flatTools) {
  const nodes = flatTools.map((t) => ({ ...t, children: [] }));
  const roots = [];
  for (const node of nodes) {
    if (!node.parent) {
      roots.push(node);
    } else {
      const parent = nodes.find((n) => n.id === node.parent);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }
  return roots;
}
function renderRouteElement(route) {
  if (routeRenderer)
    return routeRenderer(route);
  return route.element;
}
function createConsoleApp() {
  return {
    subscribe,
    getVersion,
    defineSidebar(render) {
      sidebarRenderer = render;
      bump();
    },
    defineToolbar(render) {
      toolbarRenderer = render;
      bump();
    },
    defineRouter(render) {
      routeRenderer = render;
      bump();
    },
    addRoute(input) {
      const next = routes.filter((r2) => r2.path !== input.path);
      next.push({
        path: input.path,
        name: input.name,
        element: input.element,
        parent: input.parent ?? null,
        icon: input.icon,
        requiredPermissions: input.requiredPermissions,
        requiredRoles: input.requiredRoles,
        meta: input.meta
      });
      routes = next;
      bump();
    },
    removeRoute(path) {
      routes = routes.filter((r2) => r2.path !== path);
      bump();
    },
    addTool(input) {
      const id = input.id ?? `${slugId(input.name)}-${Math.random().toString(36).slice(2, 8)}`;
      if (tools.some((t) => t.id === id)) {
        throw new Error(`[zhin-console] addTool: id already exists: ${id}`);
      }
      tools = [
        ...tools,
        {
          id,
          name: input.name,
          icon: input.icon,
          parent: input.parent ?? null,
          path: input.path
        }
      ];
      bump();
      return id;
    },
    getRouteTree() {
      return buildRouteTree(routes);
    },
    getToolTree() {
      return buildToolTree(tools);
    },
    _getRoutes() {
      return routes;
    },
    _getSidebarRenderer() {
      return sidebarRenderer;
    },
    _getToolbarRenderer() {
      return toolbarRenderer;
    },
    _renderRouteElement(route) {
      return renderRouteElement(route);
    }
  };
}
var app = createConsoleApp();

// ../../../packages/console/client/dist/websocket/types.js
var ConnectionState;
(function(ConnectionState2) {
  ConnectionState2["DISCONNECTED"] = "disconnected";
  ConnectionState2["CONNECTING"] = "connecting";
  ConnectionState2["CONNECTED"] = "connected";
  ConnectionState2["RECONNECTING"] = "reconnecting";
  ConnectionState2["ERROR"] = "error";
})(ConnectionState || (ConnectionState = {}));

// ../../../packages/console/client/dist/websocket/hooks.js
import { useCallback, useEffect, useMemo, useRef, useState } from "/esm/react.mjs?v=ms2oc1s3";

// ../../../packages/console/client/dist/store/createRegistryStore.js
import * as React from "/esm/react.mjs?v=ms2oc1s3";

// ../../../node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
function r(e) {
  var t, f, n = "";
  if ("string" == typeof e || "number" == typeof e) n += e;
  else if ("object" == typeof e) if (Array.isArray(e)) {
    var o = e.length;
    for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
  } else for (f in e) e[f] && (n && (n += " "), n += f);
  return n;
}
function clsx() {
  for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
  return n;
}

// ../../../node_modules/.pnpm/tailwind-merge@3.6.0/node_modules/tailwind-merge/dist/bundle-mjs.mjs
var concatArrays = (array1, array2) => {
  const combinedArray = new Array(array1.length + array2.length);
  for (let i = 0; i < array1.length; i++) {
    combinedArray[i] = array1[i];
  }
  for (let i = 0; i < array2.length; i++) {
    combinedArray[array1.length + i] = array2[i];
  }
  return combinedArray;
};
var createClassValidatorObject = (classGroupId, validator) => ({
  classGroupId,
  validator
});
var createClassPartObject = (nextPart = /* @__PURE__ */ new Map(), validators = null, classGroupId) => ({
  nextPart,
  validators,
  classGroupId
});
var CLASS_PART_SEPARATOR = "-";
var EMPTY_CONFLICTS = [];
var ARBITRARY_PROPERTY_PREFIX = "arbitrary..";
var createClassGroupUtils = (config) => {
  const classMap = createClassMap(config);
  const {
    conflictingClassGroups,
    conflictingClassGroupModifiers
  } = config;
  const getClassGroupId = (className) => {
    if (className.startsWith("[") && className.endsWith("]")) {
      return getGroupIdForArbitraryProperty(className);
    }
    const classParts = className.split(CLASS_PART_SEPARATOR);
    const startIndex = classParts[0] === "" && classParts.length > 1 ? 1 : 0;
    return getGroupRecursive(classParts, startIndex, classMap);
  };
  const getConflictingClassGroupIds = (classGroupId, hasPostfixModifier) => {
    if (hasPostfixModifier) {
      const modifierConflicts = conflictingClassGroupModifiers[classGroupId];
      const baseConflicts = conflictingClassGroups[classGroupId];
      if (modifierConflicts) {
        if (baseConflicts) {
          return concatArrays(baseConflicts, modifierConflicts);
        }
        return modifierConflicts;
      }
      return baseConflicts || EMPTY_CONFLICTS;
    }
    return conflictingClassGroups[classGroupId] || EMPTY_CONFLICTS;
  };
  return {
    getClassGroupId,
    getConflictingClassGroupIds
  };
};
var getGroupRecursive = (classParts, startIndex, classPartObject) => {
  const classPathsLength = classParts.length - startIndex;
  if (classPathsLength === 0) {
    return classPartObject.classGroupId;
  }
  const currentClassPart = classParts[startIndex];
  const nextClassPartObject = classPartObject.nextPart.get(currentClassPart);
  if (nextClassPartObject) {
    const result = getGroupRecursive(classParts, startIndex + 1, nextClassPartObject);
    if (result) return result;
  }
  const validators = classPartObject.validators;
  if (validators === null) {
    return void 0;
  }
  const classRest = startIndex === 0 ? classParts.join(CLASS_PART_SEPARATOR) : classParts.slice(startIndex).join(CLASS_PART_SEPARATOR);
  const validatorsLength = validators.length;
  for (let i = 0; i < validatorsLength; i++) {
    const validatorObj = validators[i];
    if (validatorObj.validator(classRest)) {
      return validatorObj.classGroupId;
    }
  }
  return void 0;
};
var getGroupIdForArbitraryProperty = (className) => className.slice(1, -1).indexOf(":") === -1 ? void 0 : (() => {
  const content = className.slice(1, -1);
  const colonIndex = content.indexOf(":");
  const property = content.slice(0, colonIndex);
  return property ? ARBITRARY_PROPERTY_PREFIX + property : void 0;
})();
var createClassMap = (config) => {
  const {
    theme,
    classGroups
  } = config;
  return processClassGroups(classGroups, theme);
};
var processClassGroups = (classGroups, theme) => {
  const classMap = createClassPartObject();
  for (const classGroupId in classGroups) {
    const group = classGroups[classGroupId];
    processClassesRecursively(group, classMap, classGroupId, theme);
  }
  return classMap;
};
var processClassesRecursively = (classGroup, classPartObject, classGroupId, theme) => {
  const len = classGroup.length;
  for (let i = 0; i < len; i++) {
    const classDefinition = classGroup[i];
    processClassDefinition(classDefinition, classPartObject, classGroupId, theme);
  }
};
var processClassDefinition = (classDefinition, classPartObject, classGroupId, theme) => {
  if (typeof classDefinition === "string") {
    processStringDefinition(classDefinition, classPartObject, classGroupId);
    return;
  }
  if (typeof classDefinition === "function") {
    processFunctionDefinition(classDefinition, classPartObject, classGroupId, theme);
    return;
  }
  processObjectDefinition(classDefinition, classPartObject, classGroupId, theme);
};
var processStringDefinition = (classDefinition, classPartObject, classGroupId) => {
  const classPartObjectToEdit = classDefinition === "" ? classPartObject : getPart(classPartObject, classDefinition);
  classPartObjectToEdit.classGroupId = classGroupId;
};
var processFunctionDefinition = (classDefinition, classPartObject, classGroupId, theme) => {
  if (isThemeGetter(classDefinition)) {
    processClassesRecursively(classDefinition(theme), classPartObject, classGroupId, theme);
    return;
  }
  if (classPartObject.validators === null) {
    classPartObject.validators = [];
  }
  classPartObject.validators.push(createClassValidatorObject(classGroupId, classDefinition));
};
var processObjectDefinition = (classDefinition, classPartObject, classGroupId, theme) => {
  const entries = Object.entries(classDefinition);
  const len = entries.length;
  for (let i = 0; i < len; i++) {
    const [key, value] = entries[i];
    processClassesRecursively(value, getPart(classPartObject, key), classGroupId, theme);
  }
};
var getPart = (classPartObject, path) => {
  let current = classPartObject;
  const parts = path.split(CLASS_PART_SEPARATOR);
  const len = parts.length;
  for (let i = 0; i < len; i++) {
    const part = parts[i];
    let next = current.nextPart.get(part);
    if (!next) {
      next = createClassPartObject();
      current.nextPart.set(part, next);
    }
    current = next;
  }
  return current;
};
var isThemeGetter = (func) => "isThemeGetter" in func && func.isThemeGetter === true;
var createLruCache = (maxCacheSize) => {
  if (maxCacheSize < 1) {
    return {
      get: () => void 0,
      set: () => {
      }
    };
  }
  let cacheSize = 0;
  let cache = /* @__PURE__ */ Object.create(null);
  let previousCache = /* @__PURE__ */ Object.create(null);
  const update = (key, value) => {
    cache[key] = value;
    cacheSize++;
    if (cacheSize > maxCacheSize) {
      cacheSize = 0;
      previousCache = cache;
      cache = /* @__PURE__ */ Object.create(null);
    }
  };
  return {
    get(key) {
      let value = cache[key];
      if (value !== void 0) {
        return value;
      }
      if ((value = previousCache[key]) !== void 0) {
        update(key, value);
        return value;
      }
    },
    set(key, value) {
      if (key in cache) {
        cache[key] = value;
      } else {
        update(key, value);
      }
    }
  };
};
var IMPORTANT_MODIFIER = "!";
var MODIFIER_SEPARATOR = ":";
var EMPTY_MODIFIERS = [];
var createResultObject = (modifiers, hasImportantModifier, baseClassName, maybePostfixModifierPosition, isExternal) => ({
  modifiers,
  hasImportantModifier,
  baseClassName,
  maybePostfixModifierPosition,
  isExternal
});
var createParseClassName = (config) => {
  const {
    prefix,
    experimentalParseClassName
  } = config;
  let parseClassName = (className) => {
    const modifiers = [];
    let bracketDepth = 0;
    let parenDepth = 0;
    let modifierStart = 0;
    let postfixModifierPosition;
    const len = className.length;
    for (let index = 0; index < len; index++) {
      const currentCharacter = className[index];
      if (bracketDepth === 0 && parenDepth === 0) {
        if (currentCharacter === MODIFIER_SEPARATOR) {
          modifiers.push(className.slice(modifierStart, index));
          modifierStart = index + 1;
          continue;
        }
        if (currentCharacter === "/") {
          postfixModifierPosition = index;
          continue;
        }
      }
      if (currentCharacter === "[") bracketDepth++;
      else if (currentCharacter === "]") bracketDepth--;
      else if (currentCharacter === "(") parenDepth++;
      else if (currentCharacter === ")") parenDepth--;
    }
    const baseClassNameWithImportantModifier = modifiers.length === 0 ? className : className.slice(modifierStart);
    let baseClassName = baseClassNameWithImportantModifier;
    let hasImportantModifier = false;
    if (baseClassNameWithImportantModifier.endsWith(IMPORTANT_MODIFIER)) {
      baseClassName = baseClassNameWithImportantModifier.slice(0, -1);
      hasImportantModifier = true;
    } else if (
      /**
       * In Tailwind CSS v3 the important modifier was at the start of the base class name. This is still supported for legacy reasons.
       * @see https://github.com/dcastil/tailwind-merge/issues/513#issuecomment-2614029864
       */
      baseClassNameWithImportantModifier.startsWith(IMPORTANT_MODIFIER)
    ) {
      baseClassName = baseClassNameWithImportantModifier.slice(1);
      hasImportantModifier = true;
    }
    const maybePostfixModifierPosition = postfixModifierPosition && postfixModifierPosition > modifierStart ? postfixModifierPosition - modifierStart : void 0;
    return createResultObject(modifiers, hasImportantModifier, baseClassName, maybePostfixModifierPosition);
  };
  if (prefix) {
    const fullPrefix = prefix + MODIFIER_SEPARATOR;
    const parseClassNameOriginal = parseClassName;
    parseClassName = (className) => className.startsWith(fullPrefix) ? parseClassNameOriginal(className.slice(fullPrefix.length)) : createResultObject(EMPTY_MODIFIERS, false, className, void 0, true);
  }
  if (experimentalParseClassName) {
    const parseClassNameOriginal = parseClassName;
    parseClassName = (className) => experimentalParseClassName({
      className,
      parseClassName: parseClassNameOriginal
    });
  }
  return parseClassName;
};
var createSortModifiers = (config) => {
  const modifierWeights = /* @__PURE__ */ new Map();
  config.orderSensitiveModifiers.forEach((mod, index) => {
    modifierWeights.set(mod, 1e6 + index);
  });
  return (modifiers) => {
    const result = [];
    let currentSegment = [];
    for (let i = 0; i < modifiers.length; i++) {
      const modifier = modifiers[i];
      const isArbitrary = modifier[0] === "[";
      const isOrderSensitive = modifierWeights.has(modifier);
      if (isArbitrary || isOrderSensitive) {
        if (currentSegment.length > 0) {
          currentSegment.sort();
          result.push(...currentSegment);
          currentSegment = [];
        }
        result.push(modifier);
      } else {
        currentSegment.push(modifier);
      }
    }
    if (currentSegment.length > 0) {
      currentSegment.sort();
      result.push(...currentSegment);
    }
    return result;
  };
};
var createConfigUtils = (config) => ({
  cache: createLruCache(config.cacheSize),
  parseClassName: createParseClassName(config),
  sortModifiers: createSortModifiers(config),
  postfixLookupClassGroupIds: createPostfixLookupClassGroupIds(config),
  ...createClassGroupUtils(config)
});
var createPostfixLookupClassGroupIds = (config) => {
  const lookup = /* @__PURE__ */ Object.create(null);
  const classGroupIds = config.postfixLookupClassGroups;
  if (classGroupIds) {
    for (let i = 0; i < classGroupIds.length; i++) {
      lookup[classGroupIds[i]] = true;
    }
  }
  return lookup;
};
var SPLIT_CLASSES_REGEX = /\s+/;
var mergeClassList = (classList, configUtils) => {
  const {
    parseClassName,
    getClassGroupId,
    getConflictingClassGroupIds,
    sortModifiers,
    postfixLookupClassGroupIds
  } = configUtils;
  const classGroupsInConflict = [];
  const classNames = classList.trim().split(SPLIT_CLASSES_REGEX);
  let result = "";
  for (let index = classNames.length - 1; index >= 0; index -= 1) {
    const originalClassName = classNames[index];
    const {
      isExternal,
      modifiers,
      hasImportantModifier,
      baseClassName,
      maybePostfixModifierPosition
    } = parseClassName(originalClassName);
    if (isExternal) {
      result = originalClassName + (result.length > 0 ? " " + result : result);
      continue;
    }
    let hasPostfixModifier = !!maybePostfixModifierPosition;
    let classGroupId;
    if (hasPostfixModifier) {
      const baseClassNameWithoutPostfix = baseClassName.substring(0, maybePostfixModifierPosition);
      classGroupId = getClassGroupId(baseClassNameWithoutPostfix);
      const classGroupIdWithPostfix = classGroupId && postfixLookupClassGroupIds[classGroupId] ? getClassGroupId(baseClassName) : void 0;
      if (classGroupIdWithPostfix && classGroupIdWithPostfix !== classGroupId) {
        classGroupId = classGroupIdWithPostfix;
        hasPostfixModifier = false;
      }
    } else {
      classGroupId = getClassGroupId(baseClassName);
    }
    if (!classGroupId) {
      if (!hasPostfixModifier) {
        result = originalClassName + (result.length > 0 ? " " + result : result);
        continue;
      }
      classGroupId = getClassGroupId(baseClassName);
      if (!classGroupId) {
        result = originalClassName + (result.length > 0 ? " " + result : result);
        continue;
      }
      hasPostfixModifier = false;
    }
    const variantModifier = modifiers.length === 0 ? "" : modifiers.length === 1 ? modifiers[0] : sortModifiers(modifiers).join(":");
    const modifierId = hasImportantModifier ? variantModifier + IMPORTANT_MODIFIER : variantModifier;
    const classId = modifierId + classGroupId;
    if (classGroupsInConflict.indexOf(classId) > -1) {
      continue;
    }
    classGroupsInConflict.push(classId);
    const conflictGroups = getConflictingClassGroupIds(classGroupId, hasPostfixModifier);
    for (let i = 0; i < conflictGroups.length; ++i) {
      const group = conflictGroups[i];
      classGroupsInConflict.push(modifierId + group);
    }
    result = originalClassName + (result.length > 0 ? " " + result : result);
  }
  return result;
};
var twJoin = (...classLists) => {
  let index = 0;
  let argument;
  let resolvedValue;
  let string = "";
  while (index < classLists.length) {
    if (argument = classLists[index++]) {
      if (resolvedValue = toValue(argument)) {
        string && (string += " ");
        string += resolvedValue;
      }
    }
  }
  return string;
};
var toValue = (mix) => {
  if (typeof mix === "string") {
    return mix;
  }
  let resolvedValue;
  let string = "";
  for (let k = 0; k < mix.length; k++) {
    if (mix[k]) {
      if (resolvedValue = toValue(mix[k])) {
        string && (string += " ");
        string += resolvedValue;
      }
    }
  }
  return string;
};
var createTailwindMerge = (createConfigFirst, ...createConfigRest) => {
  let configUtils;
  let cacheGet;
  let cacheSet;
  let functionToCall;
  const initTailwindMerge = (classList) => {
    const config = createConfigRest.reduce((previousConfig, createConfigCurrent) => createConfigCurrent(previousConfig), createConfigFirst());
    configUtils = createConfigUtils(config);
    cacheGet = configUtils.cache.get;
    cacheSet = configUtils.cache.set;
    functionToCall = tailwindMerge;
    return tailwindMerge(classList);
  };
  const tailwindMerge = (classList) => {
    const cachedResult = cacheGet(classList);
    if (cachedResult) {
      return cachedResult;
    }
    const result = mergeClassList(classList, configUtils);
    cacheSet(classList, result);
    return result;
  };
  functionToCall = initTailwindMerge;
  return (...args) => functionToCall(twJoin(...args));
};
var fallbackThemeArr = [];
var fromTheme = (key) => {
  const themeGetter = (theme) => theme[key] || fallbackThemeArr;
  themeGetter.isThemeGetter = true;
  return themeGetter;
};
var arbitraryValueRegex = /^\[(?:(\w[\w-]*):)?(.+)\]$/i;
var arbitraryVariableRegex = /^\((?:(\w[\w-]*):)?(.+)\)$/i;
var fractionRegex = /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/;
var tshirtUnitRegex = /^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/;
var lengthUnitRegex = /\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/;
var colorFunctionRegex = /^(rgba?|hsla?|hwb|(ok)?(lab|lch)|color-mix)\(.+\)$/;
var shadowRegex = /^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/;
var imageRegex = /^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/;
var isFraction = (value) => fractionRegex.test(value);
var isNumber = (value) => !!value && !Number.isNaN(Number(value));
var isInteger = (value) => !!value && Number.isInteger(Number(value));
var isPercent = (value) => value.endsWith("%") && isNumber(value.slice(0, -1));
var isTshirtSize = (value) => tshirtUnitRegex.test(value);
var isAny = () => true;
var isLengthOnly = (value) => (
  // `colorFunctionRegex` check is necessary because color functions can have percentages in them which which would be incorrectly classified as lengths.
  // For example, `hsl(0 0% 0%)` would be classified as a length without this check.
  // I could also use lookbehind assertion in `lengthUnitRegex` but that isn't supported widely enough.
  lengthUnitRegex.test(value) && !colorFunctionRegex.test(value)
);
var isNever = () => false;
var isShadow = (value) => shadowRegex.test(value);
var isImage = (value) => imageRegex.test(value);
var isAnyNonArbitrary = (value) => !isArbitraryValue(value) && !isArbitraryVariable(value);
var isNamedContainerQuery = (value) => value.startsWith("@container") && (value[10] === "/" && value[11] !== void 0 || value[11] === "s" && value[16] !== void 0 && value.startsWith("-size/", 10) || value[11] === "n" && value[18] !== void 0 && value.startsWith("-normal/", 10));
var isArbitrarySize = (value) => getIsArbitraryValue(value, isLabelSize, isNever);
var isArbitraryValue = (value) => arbitraryValueRegex.test(value);
var isArbitraryLength = (value) => getIsArbitraryValue(value, isLabelLength, isLengthOnly);
var isArbitraryNumber = (value) => getIsArbitraryValue(value, isLabelNumber, isNumber);
var isArbitraryWeight = (value) => getIsArbitraryValue(value, isLabelWeight, isAny);
var isArbitraryFamilyName = (value) => getIsArbitraryValue(value, isLabelFamilyName, isNever);
var isArbitraryPosition = (value) => getIsArbitraryValue(value, isLabelPosition, isNever);
var isArbitraryImage = (value) => getIsArbitraryValue(value, isLabelImage, isImage);
var isArbitraryShadow = (value) => getIsArbitraryValue(value, isLabelShadow, isShadow);
var isArbitraryVariable = (value) => arbitraryVariableRegex.test(value);
var isArbitraryVariableLength = (value) => getIsArbitraryVariable(value, isLabelLength);
var isArbitraryVariableFamilyName = (value) => getIsArbitraryVariable(value, isLabelFamilyName);
var isArbitraryVariablePosition = (value) => getIsArbitraryVariable(value, isLabelPosition);
var isArbitraryVariableSize = (value) => getIsArbitraryVariable(value, isLabelSize);
var isArbitraryVariableImage = (value) => getIsArbitraryVariable(value, isLabelImage);
var isArbitraryVariableShadow = (value) => getIsArbitraryVariable(value, isLabelShadow, true);
var isArbitraryVariableWeight = (value) => getIsArbitraryVariable(value, isLabelWeight, true);
var getIsArbitraryValue = (value, testLabel, testValue) => {
  const result = arbitraryValueRegex.exec(value);
  if (result) {
    if (result[1]) {
      return testLabel(result[1]);
    }
    return testValue(result[2]);
  }
  return false;
};
var getIsArbitraryVariable = (value, testLabel, shouldMatchNoLabel = false) => {
  const result = arbitraryVariableRegex.exec(value);
  if (result) {
    if (result[1]) {
      return testLabel(result[1]);
    }
    return shouldMatchNoLabel;
  }
  return false;
};
var isLabelPosition = (label) => label === "position" || label === "percentage";
var isLabelImage = (label) => label === "image" || label === "url";
var isLabelSize = (label) => label === "length" || label === "size" || label === "bg-size";
var isLabelLength = (label) => label === "length";
var isLabelNumber = (label) => label === "number";
var isLabelFamilyName = (label) => label === "family-name";
var isLabelWeight = (label) => label === "number" || label === "weight";
var isLabelShadow = (label) => label === "shadow";
var getDefaultConfig = () => {
  const themeColor = fromTheme("color");
  const themeFont = fromTheme("font");
  const themeText = fromTheme("text");
  const themeFontWeight = fromTheme("font-weight");
  const themeTracking = fromTheme("tracking");
  const themeLeading = fromTheme("leading");
  const themeBreakpoint = fromTheme("breakpoint");
  const themeContainer = fromTheme("container");
  const themeSpacing = fromTheme("spacing");
  const themeRadius = fromTheme("radius");
  const themeShadow = fromTheme("shadow");
  const themeInsetShadow = fromTheme("inset-shadow");
  const themeTextShadow = fromTheme("text-shadow");
  const themeDropShadow = fromTheme("drop-shadow");
  const themeBlur = fromTheme("blur");
  const themePerspective = fromTheme("perspective");
  const themeAspect = fromTheme("aspect");
  const themeEase = fromTheme("ease");
  const themeAnimate = fromTheme("animate");
  const scaleBreak = () => ["auto", "avoid", "all", "avoid-page", "page", "left", "right", "column"];
  const scalePosition = () => [
    "center",
    "top",
    "bottom",
    "left",
    "right",
    "top-left",
    // Deprecated since Tailwind CSS v4.1.0, see https://github.com/tailwindlabs/tailwindcss/pull/17378
    "left-top",
    "top-right",
    // Deprecated since Tailwind CSS v4.1.0, see https://github.com/tailwindlabs/tailwindcss/pull/17378
    "right-top",
    "bottom-right",
    // Deprecated since Tailwind CSS v4.1.0, see https://github.com/tailwindlabs/tailwindcss/pull/17378
    "right-bottom",
    "bottom-left",
    // Deprecated since Tailwind CSS v4.1.0, see https://github.com/tailwindlabs/tailwindcss/pull/17378
    "left-bottom"
  ];
  const scalePositionWithArbitrary = () => [...scalePosition(), isArbitraryVariable, isArbitraryValue];
  const scaleOverflow = () => ["auto", "hidden", "clip", "visible", "scroll"];
  const scaleOverscroll = () => ["auto", "contain", "none"];
  const scaleUnambiguousSpacing = () => [isArbitraryVariable, isArbitraryValue, themeSpacing];
  const scaleInset = () => [isFraction, "full", "auto", ...scaleUnambiguousSpacing()];
  const scaleGridTemplateColsRows = () => [isInteger, "none", "subgrid", isArbitraryVariable, isArbitraryValue];
  const scaleGridColRowStartAndEnd = () => ["auto", {
    span: ["full", isInteger, isArbitraryVariable, isArbitraryValue]
  }, isInteger, isArbitraryVariable, isArbitraryValue];
  const scaleGridColRowStartOrEnd = () => [isInteger, "auto", isArbitraryVariable, isArbitraryValue];
  const scaleGridAutoColsRows = () => ["auto", "min", "max", "fr", isArbitraryVariable, isArbitraryValue];
  const scaleAlignPrimaryAxis = () => ["start", "end", "center", "between", "around", "evenly", "stretch", "baseline", "center-safe", "end-safe"];
  const scaleAlignSecondaryAxis = () => ["start", "end", "center", "stretch", "center-safe", "end-safe"];
  const scaleMargin = () => ["auto", ...scaleUnambiguousSpacing()];
  const scaleSizing = () => [isFraction, "auto", "full", "dvw", "dvh", "lvw", "lvh", "svw", "svh", "min", "max", "fit", ...scaleUnambiguousSpacing()];
  const scaleSizingInline = () => [isFraction, "screen", "full", "dvw", "lvw", "svw", "min", "max", "fit", ...scaleUnambiguousSpacing()];
  const scaleSizingBlock = () => [isFraction, "screen", "full", "lh", "dvh", "lvh", "svh", "min", "max", "fit", ...scaleUnambiguousSpacing()];
  const scaleColor = () => [themeColor, isArbitraryVariable, isArbitraryValue];
  const scaleBgPosition = () => [...scalePosition(), isArbitraryVariablePosition, isArbitraryPosition, {
    position: [isArbitraryVariable, isArbitraryValue]
  }];
  const scaleBgRepeat = () => ["no-repeat", {
    repeat: ["", "x", "y", "space", "round"]
  }];
  const scaleBgSize = () => ["auto", "cover", "contain", isArbitraryVariableSize, isArbitrarySize, {
    size: [isArbitraryVariable, isArbitraryValue]
  }];
  const scaleGradientStopPosition = () => [isPercent, isArbitraryVariableLength, isArbitraryLength];
  const scaleRadius = () => [
    // Deprecated since Tailwind CSS v4.0.0
    "",
    "none",
    "full",
    themeRadius,
    isArbitraryVariable,
    isArbitraryValue
  ];
  const scaleBorderWidth = () => ["", isNumber, isArbitraryVariableLength, isArbitraryLength];
  const scaleLineStyle = () => ["solid", "dashed", "dotted", "double"];
  const scaleBlendMode = () => ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"];
  const scaleMaskImagePosition = () => [isNumber, isPercent, isArbitraryVariablePosition, isArbitraryPosition];
  const scaleBlur = () => [
    // Deprecated since Tailwind CSS v4.0.0
    "",
    "none",
    themeBlur,
    isArbitraryVariable,
    isArbitraryValue
  ];
  const scaleRotate = () => ["none", isNumber, isArbitraryVariable, isArbitraryValue];
  const scaleScale = () => ["none", isNumber, isArbitraryVariable, isArbitraryValue];
  const scaleSkew = () => [isNumber, isArbitraryVariable, isArbitraryValue];
  const scaleTranslate = () => [isFraction, "full", ...scaleUnambiguousSpacing()];
  return {
    cacheSize: 500,
    theme: {
      animate: ["spin", "ping", "pulse", "bounce"],
      aspect: ["video"],
      blur: [isTshirtSize],
      breakpoint: [isTshirtSize],
      color: [isAny],
      container: [isTshirtSize],
      "drop-shadow": [isTshirtSize],
      ease: ["in", "out", "in-out"],
      font: [isAnyNonArbitrary],
      "font-weight": ["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"],
      "inset-shadow": [isTshirtSize],
      leading: ["none", "tight", "snug", "normal", "relaxed", "loose"],
      perspective: ["dramatic", "near", "normal", "midrange", "distant", "none"],
      radius: [isTshirtSize],
      shadow: [isTshirtSize],
      spacing: ["px", isNumber],
      text: [isTshirtSize],
      "text-shadow": [isTshirtSize],
      tracking: ["tighter", "tight", "normal", "wide", "wider", "widest"]
    },
    classGroups: {
      // --------------
      // --- Layout ---
      // --------------
      /**
       * Aspect Ratio
       * @see https://tailwindcss.com/docs/aspect-ratio
       */
      aspect: [{
        aspect: ["auto", "square", isFraction, isArbitraryValue, isArbitraryVariable, themeAspect]
      }],
      /**
       * Container
       * @see https://tailwindcss.com/docs/container
       * @deprecated since Tailwind CSS v4.0.0
       */
      container: ["container"],
      /**
       * Container Type
       * @see https://tailwindcss.com/docs/responsive-design#container-queries
       */
      "container-type": [{
        "@container": ["", "normal", "size", isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Container Name
       * @see https://tailwindcss.com/docs/responsive-design#named-containers
       */
      "container-named": [isNamedContainerQuery],
      /**
       * Columns
       * @see https://tailwindcss.com/docs/columns
       */
      columns: [{
        columns: [isNumber, isArbitraryValue, isArbitraryVariable, themeContainer]
      }],
      /**
       * Break After
       * @see https://tailwindcss.com/docs/break-after
       */
      "break-after": [{
        "break-after": scaleBreak()
      }],
      /**
       * Break Before
       * @see https://tailwindcss.com/docs/break-before
       */
      "break-before": [{
        "break-before": scaleBreak()
      }],
      /**
       * Break Inside
       * @see https://tailwindcss.com/docs/break-inside
       */
      "break-inside": [{
        "break-inside": ["auto", "avoid", "avoid-page", "avoid-column"]
      }],
      /**
       * Box Decoration Break
       * @see https://tailwindcss.com/docs/box-decoration-break
       */
      "box-decoration": [{
        "box-decoration": ["slice", "clone"]
      }],
      /**
       * Box Sizing
       * @see https://tailwindcss.com/docs/box-sizing
       */
      box: [{
        box: ["border", "content"]
      }],
      /**
       * Display
       * @see https://tailwindcss.com/docs/display
       */
      display: ["block", "inline-block", "inline", "flex", "inline-flex", "table", "inline-table", "table-caption", "table-cell", "table-column", "table-column-group", "table-footer-group", "table-header-group", "table-row-group", "table-row", "flow-root", "grid", "inline-grid", "contents", "list-item", "hidden"],
      /**
       * Screen Reader Only
       * @see https://tailwindcss.com/docs/display#screen-reader-only
       */
      sr: ["sr-only", "not-sr-only"],
      /**
       * Floats
       * @see https://tailwindcss.com/docs/float
       */
      float: [{
        float: ["right", "left", "none", "start", "end"]
      }],
      /**
       * Clear
       * @see https://tailwindcss.com/docs/clear
       */
      clear: [{
        clear: ["left", "right", "both", "none", "start", "end"]
      }],
      /**
       * Isolation
       * @see https://tailwindcss.com/docs/isolation
       */
      isolation: ["isolate", "isolation-auto"],
      /**
       * Object Fit
       * @see https://tailwindcss.com/docs/object-fit
       */
      "object-fit": [{
        object: ["contain", "cover", "fill", "none", "scale-down"]
      }],
      /**
       * Object Position
       * @see https://tailwindcss.com/docs/object-position
       */
      "object-position": [{
        object: scalePositionWithArbitrary()
      }],
      /**
       * Overflow
       * @see https://tailwindcss.com/docs/overflow
       */
      overflow: [{
        overflow: scaleOverflow()
      }],
      /**
       * Overflow X
       * @see https://tailwindcss.com/docs/overflow
       */
      "overflow-x": [{
        "overflow-x": scaleOverflow()
      }],
      /**
       * Overflow Y
       * @see https://tailwindcss.com/docs/overflow
       */
      "overflow-y": [{
        "overflow-y": scaleOverflow()
      }],
      /**
       * Overscroll Behavior
       * @see https://tailwindcss.com/docs/overscroll-behavior
       */
      overscroll: [{
        overscroll: scaleOverscroll()
      }],
      /**
       * Overscroll Behavior X
       * @see https://tailwindcss.com/docs/overscroll-behavior
       */
      "overscroll-x": [{
        "overscroll-x": scaleOverscroll()
      }],
      /**
       * Overscroll Behavior Y
       * @see https://tailwindcss.com/docs/overscroll-behavior
       */
      "overscroll-y": [{
        "overscroll-y": scaleOverscroll()
      }],
      /**
       * Position
       * @see https://tailwindcss.com/docs/position
       */
      position: ["static", "fixed", "absolute", "relative", "sticky"],
      /**
       * Inset
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      inset: [{
        inset: scaleInset()
      }],
      /**
       * Inset Inline
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      "inset-x": [{
        "inset-x": scaleInset()
      }],
      /**
       * Inset Block
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      "inset-y": [{
        "inset-y": scaleInset()
      }],
      /**
       * Inset Inline Start
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       * @todo class group will be renamed to `inset-s` in next major release
       */
      start: [{
        "inset-s": scaleInset(),
        /**
         * @deprecated since Tailwind CSS v4.2.0 in favor of `inset-s-*` utilities.
         * @see https://github.com/tailwindlabs/tailwindcss/pull/19613
         */
        start: scaleInset()
      }],
      /**
       * Inset Inline End
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       * @todo class group will be renamed to `inset-e` in next major release
       */
      end: [{
        "inset-e": scaleInset(),
        /**
         * @deprecated since Tailwind CSS v4.2.0 in favor of `inset-e-*` utilities.
         * @see https://github.com/tailwindlabs/tailwindcss/pull/19613
         */
        end: scaleInset()
      }],
      /**
       * Inset Block Start
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      "inset-bs": [{
        "inset-bs": scaleInset()
      }],
      /**
       * Inset Block End
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      "inset-be": [{
        "inset-be": scaleInset()
      }],
      /**
       * Top
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      top: [{
        top: scaleInset()
      }],
      /**
       * Right
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      right: [{
        right: scaleInset()
      }],
      /**
       * Bottom
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      bottom: [{
        bottom: scaleInset()
      }],
      /**
       * Left
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      left: [{
        left: scaleInset()
      }],
      /**
       * Visibility
       * @see https://tailwindcss.com/docs/visibility
       */
      visibility: ["visible", "invisible", "collapse"],
      /**
       * Z-Index
       * @see https://tailwindcss.com/docs/z-index
       */
      z: [{
        z: [isInteger, "auto", isArbitraryVariable, isArbitraryValue]
      }],
      // ------------------------
      // --- Flexbox and Grid ---
      // ------------------------
      /**
       * Flex Basis
       * @see https://tailwindcss.com/docs/flex-basis
       */
      basis: [{
        basis: [isFraction, "full", "auto", themeContainer, ...scaleUnambiguousSpacing()]
      }],
      /**
       * Flex Direction
       * @see https://tailwindcss.com/docs/flex-direction
       */
      "flex-direction": [{
        flex: ["row", "row-reverse", "col", "col-reverse"]
      }],
      /**
       * Flex Wrap
       * @see https://tailwindcss.com/docs/flex-wrap
       */
      "flex-wrap": [{
        flex: ["nowrap", "wrap", "wrap-reverse"]
      }],
      /**
       * Flex
       * @see https://tailwindcss.com/docs/flex
       */
      flex: [{
        flex: [isNumber, isFraction, "auto", "initial", "none", isArbitraryValue]
      }],
      /**
       * Flex Grow
       * @see https://tailwindcss.com/docs/flex-grow
       */
      grow: [{
        grow: ["", isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Flex Shrink
       * @see https://tailwindcss.com/docs/flex-shrink
       */
      shrink: [{
        shrink: ["", isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Order
       * @see https://tailwindcss.com/docs/order
       */
      order: [{
        order: [isInteger, "first", "last", "none", isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Grid Template Columns
       * @see https://tailwindcss.com/docs/grid-template-columns
       */
      "grid-cols": [{
        "grid-cols": scaleGridTemplateColsRows()
      }],
      /**
       * Grid Column Start / End
       * @see https://tailwindcss.com/docs/grid-column
       */
      "col-start-end": [{
        col: scaleGridColRowStartAndEnd()
      }],
      /**
       * Grid Column Start
       * @see https://tailwindcss.com/docs/grid-column
       */
      "col-start": [{
        "col-start": scaleGridColRowStartOrEnd()
      }],
      /**
       * Grid Column End
       * @see https://tailwindcss.com/docs/grid-column
       */
      "col-end": [{
        "col-end": scaleGridColRowStartOrEnd()
      }],
      /**
       * Grid Template Rows
       * @see https://tailwindcss.com/docs/grid-template-rows
       */
      "grid-rows": [{
        "grid-rows": scaleGridTemplateColsRows()
      }],
      /**
       * Grid Row Start / End
       * @see https://tailwindcss.com/docs/grid-row
       */
      "row-start-end": [{
        row: scaleGridColRowStartAndEnd()
      }],
      /**
       * Grid Row Start
       * @see https://tailwindcss.com/docs/grid-row
       */
      "row-start": [{
        "row-start": scaleGridColRowStartOrEnd()
      }],
      /**
       * Grid Row End
       * @see https://tailwindcss.com/docs/grid-row
       */
      "row-end": [{
        "row-end": scaleGridColRowStartOrEnd()
      }],
      /**
       * Grid Auto Flow
       * @see https://tailwindcss.com/docs/grid-auto-flow
       */
      "grid-flow": [{
        "grid-flow": ["row", "col", "dense", "row-dense", "col-dense"]
      }],
      /**
       * Grid Auto Columns
       * @see https://tailwindcss.com/docs/grid-auto-columns
       */
      "auto-cols": [{
        "auto-cols": scaleGridAutoColsRows()
      }],
      /**
       * Grid Auto Rows
       * @see https://tailwindcss.com/docs/grid-auto-rows
       */
      "auto-rows": [{
        "auto-rows": scaleGridAutoColsRows()
      }],
      /**
       * Gap
       * @see https://tailwindcss.com/docs/gap
       */
      gap: [{
        gap: scaleUnambiguousSpacing()
      }],
      /**
       * Gap X
       * @see https://tailwindcss.com/docs/gap
       */
      "gap-x": [{
        "gap-x": scaleUnambiguousSpacing()
      }],
      /**
       * Gap Y
       * @see https://tailwindcss.com/docs/gap
       */
      "gap-y": [{
        "gap-y": scaleUnambiguousSpacing()
      }],
      /**
       * Justify Content
       * @see https://tailwindcss.com/docs/justify-content
       */
      "justify-content": [{
        justify: [...scaleAlignPrimaryAxis(), "normal"]
      }],
      /**
       * Justify Items
       * @see https://tailwindcss.com/docs/justify-items
       */
      "justify-items": [{
        "justify-items": [...scaleAlignSecondaryAxis(), "normal"]
      }],
      /**
       * Justify Self
       * @see https://tailwindcss.com/docs/justify-self
       */
      "justify-self": [{
        "justify-self": ["auto", ...scaleAlignSecondaryAxis()]
      }],
      /**
       * Align Content
       * @see https://tailwindcss.com/docs/align-content
       */
      "align-content": [{
        content: ["normal", ...scaleAlignPrimaryAxis()]
      }],
      /**
       * Align Items
       * @see https://tailwindcss.com/docs/align-items
       */
      "align-items": [{
        items: [...scaleAlignSecondaryAxis(), {
          baseline: ["", "last"]
        }]
      }],
      /**
       * Align Self
       * @see https://tailwindcss.com/docs/align-self
       */
      "align-self": [{
        self: ["auto", ...scaleAlignSecondaryAxis(), {
          baseline: ["", "last"]
        }]
      }],
      /**
       * Place Content
       * @see https://tailwindcss.com/docs/place-content
       */
      "place-content": [{
        "place-content": scaleAlignPrimaryAxis()
      }],
      /**
       * Place Items
       * @see https://tailwindcss.com/docs/place-items
       */
      "place-items": [{
        "place-items": [...scaleAlignSecondaryAxis(), "baseline"]
      }],
      /**
       * Place Self
       * @see https://tailwindcss.com/docs/place-self
       */
      "place-self": [{
        "place-self": ["auto", ...scaleAlignSecondaryAxis()]
      }],
      // Spacing
      /**
       * Padding
       * @see https://tailwindcss.com/docs/padding
       */
      p: [{
        p: scaleUnambiguousSpacing()
      }],
      /**
       * Padding Inline
       * @see https://tailwindcss.com/docs/padding
       */
      px: [{
        px: scaleUnambiguousSpacing()
      }],
      /**
       * Padding Block
       * @see https://tailwindcss.com/docs/padding
       */
      py: [{
        py: scaleUnambiguousSpacing()
      }],
      /**
       * Padding Inline Start
       * @see https://tailwindcss.com/docs/padding
       */
      ps: [{
        ps: scaleUnambiguousSpacing()
      }],
      /**
       * Padding Inline End
       * @see https://tailwindcss.com/docs/padding
       */
      pe: [{
        pe: scaleUnambiguousSpacing()
      }],
      /**
       * Padding Block Start
       * @see https://tailwindcss.com/docs/padding
       */
      pbs: [{
        pbs: scaleUnambiguousSpacing()
      }],
      /**
       * Padding Block End
       * @see https://tailwindcss.com/docs/padding
       */
      pbe: [{
        pbe: scaleUnambiguousSpacing()
      }],
      /**
       * Padding Top
       * @see https://tailwindcss.com/docs/padding
       */
      pt: [{
        pt: scaleUnambiguousSpacing()
      }],
      /**
       * Padding Right
       * @see https://tailwindcss.com/docs/padding
       */
      pr: [{
        pr: scaleUnambiguousSpacing()
      }],
      /**
       * Padding Bottom
       * @see https://tailwindcss.com/docs/padding
       */
      pb: [{
        pb: scaleUnambiguousSpacing()
      }],
      /**
       * Padding Left
       * @see https://tailwindcss.com/docs/padding
       */
      pl: [{
        pl: scaleUnambiguousSpacing()
      }],
      /**
       * Margin
       * @see https://tailwindcss.com/docs/margin
       */
      m: [{
        m: scaleMargin()
      }],
      /**
       * Margin Inline
       * @see https://tailwindcss.com/docs/margin
       */
      mx: [{
        mx: scaleMargin()
      }],
      /**
       * Margin Block
       * @see https://tailwindcss.com/docs/margin
       */
      my: [{
        my: scaleMargin()
      }],
      /**
       * Margin Inline Start
       * @see https://tailwindcss.com/docs/margin
       */
      ms: [{
        ms: scaleMargin()
      }],
      /**
       * Margin Inline End
       * @see https://tailwindcss.com/docs/margin
       */
      me: [{
        me: scaleMargin()
      }],
      /**
       * Margin Block Start
       * @see https://tailwindcss.com/docs/margin
       */
      mbs: [{
        mbs: scaleMargin()
      }],
      /**
       * Margin Block End
       * @see https://tailwindcss.com/docs/margin
       */
      mbe: [{
        mbe: scaleMargin()
      }],
      /**
       * Margin Top
       * @see https://tailwindcss.com/docs/margin
       */
      mt: [{
        mt: scaleMargin()
      }],
      /**
       * Margin Right
       * @see https://tailwindcss.com/docs/margin
       */
      mr: [{
        mr: scaleMargin()
      }],
      /**
       * Margin Bottom
       * @see https://tailwindcss.com/docs/margin
       */
      mb: [{
        mb: scaleMargin()
      }],
      /**
       * Margin Left
       * @see https://tailwindcss.com/docs/margin
       */
      ml: [{
        ml: scaleMargin()
      }],
      /**
       * Space Between X
       * @see https://tailwindcss.com/docs/margin#adding-space-between-children
       */
      "space-x": [{
        "space-x": scaleUnambiguousSpacing()
      }],
      /**
       * Space Between X Reverse
       * @see https://tailwindcss.com/docs/margin#adding-space-between-children
       */
      "space-x-reverse": ["space-x-reverse"],
      /**
       * Space Between Y
       * @see https://tailwindcss.com/docs/margin#adding-space-between-children
       */
      "space-y": [{
        "space-y": scaleUnambiguousSpacing()
      }],
      /**
       * Space Between Y Reverse
       * @see https://tailwindcss.com/docs/margin#adding-space-between-children
       */
      "space-y-reverse": ["space-y-reverse"],
      // --------------
      // --- Sizing ---
      // --------------
      /**
       * Size
       * @see https://tailwindcss.com/docs/width#setting-both-width-and-height
       */
      size: [{
        size: scaleSizing()
      }],
      /**
       * Inline Size
       * @see https://tailwindcss.com/docs/width
       */
      "inline-size": [{
        inline: ["auto", ...scaleSizingInline()]
      }],
      /**
       * Min-Inline Size
       * @see https://tailwindcss.com/docs/min-width
       */
      "min-inline-size": [{
        "min-inline": ["auto", ...scaleSizingInline()]
      }],
      /**
       * Max-Inline Size
       * @see https://tailwindcss.com/docs/max-width
       */
      "max-inline-size": [{
        "max-inline": ["none", ...scaleSizingInline()]
      }],
      /**
       * Block Size
       * @see https://tailwindcss.com/docs/height
       */
      "block-size": [{
        block: ["auto", ...scaleSizingBlock()]
      }],
      /**
       * Min-Block Size
       * @see https://tailwindcss.com/docs/min-height
       */
      "min-block-size": [{
        "min-block": ["auto", ...scaleSizingBlock()]
      }],
      /**
       * Max-Block Size
       * @see https://tailwindcss.com/docs/max-height
       */
      "max-block-size": [{
        "max-block": ["none", ...scaleSizingBlock()]
      }],
      /**
       * Width
       * @see https://tailwindcss.com/docs/width
       */
      w: [{
        w: [themeContainer, "screen", ...scaleSizing()]
      }],
      /**
       * Min-Width
       * @see https://tailwindcss.com/docs/min-width
       */
      "min-w": [{
        "min-w": [
          themeContainer,
          "screen",
          /** Deprecated. @see https://github.com/tailwindlabs/tailwindcss.com/issues/2027#issuecomment-2620152757 */
          "none",
          ...scaleSizing()
        ]
      }],
      /**
       * Max-Width
       * @see https://tailwindcss.com/docs/max-width
       */
      "max-w": [{
        "max-w": [
          themeContainer,
          "screen",
          "none",
          /** Deprecated since Tailwind CSS v4.0.0. @see https://github.com/tailwindlabs/tailwindcss.com/issues/2027#issuecomment-2620152757 */
          "prose",
          /** Deprecated since Tailwind CSS v4.0.0. @see https://github.com/tailwindlabs/tailwindcss.com/issues/2027#issuecomment-2620152757 */
          {
            screen: [themeBreakpoint]
          },
          ...scaleSizing()
        ]
      }],
      /**
       * Height
       * @see https://tailwindcss.com/docs/height
       */
      h: [{
        h: ["screen", "lh", ...scaleSizing()]
      }],
      /**
       * Min-Height
       * @see https://tailwindcss.com/docs/min-height
       */
      "min-h": [{
        "min-h": ["screen", "lh", "none", ...scaleSizing()]
      }],
      /**
       * Max-Height
       * @see https://tailwindcss.com/docs/max-height
       */
      "max-h": [{
        "max-h": ["screen", "lh", ...scaleSizing()]
      }],
      // ------------------
      // --- Typography ---
      // ------------------
      /**
       * Font Size
       * @see https://tailwindcss.com/docs/font-size
       */
      "font-size": [{
        text: ["base", themeText, isArbitraryVariableLength, isArbitraryLength]
      }],
      /**
       * Font Smoothing
       * @see https://tailwindcss.com/docs/font-smoothing
       */
      "font-smoothing": ["antialiased", "subpixel-antialiased"],
      /**
       * Font Style
       * @see https://tailwindcss.com/docs/font-style
       */
      "font-style": ["italic", "not-italic"],
      /**
       * Font Weight
       * @see https://tailwindcss.com/docs/font-weight
       */
      "font-weight": [{
        font: [themeFontWeight, isArbitraryVariableWeight, isArbitraryWeight]
      }],
      /**
       * Font Stretch
       * @see https://tailwindcss.com/docs/font-stretch
       */
      "font-stretch": [{
        "font-stretch": ["ultra-condensed", "extra-condensed", "condensed", "semi-condensed", "normal", "semi-expanded", "expanded", "extra-expanded", "ultra-expanded", isPercent, isArbitraryValue]
      }],
      /**
       * Font Family
       * @see https://tailwindcss.com/docs/font-family
       */
      "font-family": [{
        font: [isArbitraryVariableFamilyName, isArbitraryFamilyName, themeFont]
      }],
      /**
       * Font Feature Settings
       * @see https://tailwindcss.com/docs/font-feature-settings
       */
      "font-features": [{
        "font-features": [isArbitraryValue]
      }],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-normal": ["normal-nums"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-ordinal": ["ordinal"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-slashed-zero": ["slashed-zero"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-figure": ["lining-nums", "oldstyle-nums"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-spacing": ["proportional-nums", "tabular-nums"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-fraction": ["diagonal-fractions", "stacked-fractions"],
      /**
       * Letter Spacing
       * @see https://tailwindcss.com/docs/letter-spacing
       */
      tracking: [{
        tracking: [themeTracking, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Line Clamp
       * @see https://tailwindcss.com/docs/line-clamp
       */
      "line-clamp": [{
        "line-clamp": [isNumber, "none", isArbitraryVariable, isArbitraryNumber]
      }],
      /**
       * Line Height
       * @see https://tailwindcss.com/docs/line-height
       */
      leading: [{
        leading: [
          /** Deprecated since Tailwind CSS v4.0.0. @see https://github.com/tailwindlabs/tailwindcss.com/issues/2027#issuecomment-2620152757 */
          themeLeading,
          ...scaleUnambiguousSpacing()
        ]
      }],
      /**
       * List Style Image
       * @see https://tailwindcss.com/docs/list-style-image
       */
      "list-image": [{
        "list-image": ["none", isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * List Style Position
       * @see https://tailwindcss.com/docs/list-style-position
       */
      "list-style-position": [{
        list: ["inside", "outside"]
      }],
      /**
       * List Style Type
       * @see https://tailwindcss.com/docs/list-style-type
       */
      "list-style-type": [{
        list: ["disc", "decimal", "none", isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Text Alignment
       * @see https://tailwindcss.com/docs/text-align
       */
      "text-alignment": [{
        text: ["left", "center", "right", "justify", "start", "end"]
      }],
      /**
       * Placeholder Color
       * @deprecated since Tailwind CSS v3.0.0
       * @see https://v3.tailwindcss.com/docs/placeholder-color
       */
      "placeholder-color": [{
        placeholder: scaleColor()
      }],
      /**
       * Text Color
       * @see https://tailwindcss.com/docs/text-color
       */
      "text-color": [{
        text: scaleColor()
      }],
      /**
       * Text Decoration
       * @see https://tailwindcss.com/docs/text-decoration
       */
      "text-decoration": ["underline", "overline", "line-through", "no-underline"],
      /**
       * Text Decoration Style
       * @see https://tailwindcss.com/docs/text-decoration-style
       */
      "text-decoration-style": [{
        decoration: [...scaleLineStyle(), "wavy"]
      }],
      /**
       * Text Decoration Thickness
       * @see https://tailwindcss.com/docs/text-decoration-thickness
       */
      "text-decoration-thickness": [{
        decoration: [isNumber, "from-font", "auto", isArbitraryVariable, isArbitraryLength]
      }],
      /**
       * Text Decoration Color
       * @see https://tailwindcss.com/docs/text-decoration-color
       */
      "text-decoration-color": [{
        decoration: scaleColor()
      }],
      /**
       * Text Underline Offset
       * @see https://tailwindcss.com/docs/text-underline-offset
       */
      "underline-offset": [{
        "underline-offset": [isNumber, "auto", isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Text Transform
       * @see https://tailwindcss.com/docs/text-transform
       */
      "text-transform": ["uppercase", "lowercase", "capitalize", "normal-case"],
      /**
       * Text Overflow
       * @see https://tailwindcss.com/docs/text-overflow
       */
      "text-overflow": ["truncate", "text-ellipsis", "text-clip"],
      /**
       * Text Wrap
       * @see https://tailwindcss.com/docs/text-wrap
       */
      "text-wrap": [{
        text: ["wrap", "nowrap", "balance", "pretty"]
      }],
      /**
       * Text Indent
       * @see https://tailwindcss.com/docs/text-indent
       */
      indent: [{
        indent: scaleUnambiguousSpacing()
      }],
      /**
       * Tab Size
       * @see https://tailwindcss.com/docs/tab-size
       */
      "tab-size": [{
        tab: [isInteger, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Vertical Alignment
       * @see https://tailwindcss.com/docs/vertical-align
       */
      "vertical-align": [{
        align: ["baseline", "top", "middle", "bottom", "text-top", "text-bottom", "sub", "super", isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Whitespace
       * @see https://tailwindcss.com/docs/whitespace
       */
      whitespace: [{
        whitespace: ["normal", "nowrap", "pre", "pre-line", "pre-wrap", "break-spaces"]
      }],
      /**
       * Word Break
       * @see https://tailwindcss.com/docs/word-break
       */
      break: [{
        break: ["normal", "words", "all", "keep"]
      }],
      /**
       * Overflow Wrap
       * @see https://tailwindcss.com/docs/overflow-wrap
       */
      wrap: [{
        wrap: ["break-word", "anywhere", "normal"]
      }],
      /**
       * Hyphens
       * @see https://tailwindcss.com/docs/hyphens
       */
      hyphens: [{
        hyphens: ["none", "manual", "auto"]
      }],
      /**
       * Content
       * @see https://tailwindcss.com/docs/content
       */
      content: [{
        content: ["none", isArbitraryVariable, isArbitraryValue]
      }],
      // -------------------
      // --- Backgrounds ---
      // -------------------
      /**
       * Background Attachment
       * @see https://tailwindcss.com/docs/background-attachment
       */
      "bg-attachment": [{
        bg: ["fixed", "local", "scroll"]
      }],
      /**
       * Background Clip
       * @see https://tailwindcss.com/docs/background-clip
       */
      "bg-clip": [{
        "bg-clip": ["border", "padding", "content", "text"]
      }],
      /**
       * Background Origin
       * @see https://tailwindcss.com/docs/background-origin
       */
      "bg-origin": [{
        "bg-origin": ["border", "padding", "content"]
      }],
      /**
       * Background Position
       * @see https://tailwindcss.com/docs/background-position
       */
      "bg-position": [{
        bg: scaleBgPosition()
      }],
      /**
       * Background Repeat
       * @see https://tailwindcss.com/docs/background-repeat
       */
      "bg-repeat": [{
        bg: scaleBgRepeat()
      }],
      /**
       * Background Size
       * @see https://tailwindcss.com/docs/background-size
       */
      "bg-size": [{
        bg: scaleBgSize()
      }],
      /**
       * Background Image
       * @see https://tailwindcss.com/docs/background-image
       */
      "bg-image": [{
        bg: ["none", {
          linear: [{
            to: ["t", "tr", "r", "br", "b", "bl", "l", "tl"]
          }, isInteger, isArbitraryVariable, isArbitraryValue],
          radial: ["", isArbitraryVariable, isArbitraryValue],
          conic: [isInteger, isArbitraryVariable, isArbitraryValue]
        }, isArbitraryVariableImage, isArbitraryImage]
      }],
      /**
       * Background Color
       * @see https://tailwindcss.com/docs/background-color
       */
      "bg-color": [{
        bg: scaleColor()
      }],
      /**
       * Gradient Color Stops From Position
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-from-pos": [{
        from: scaleGradientStopPosition()
      }],
      /**
       * Gradient Color Stops Via Position
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-via-pos": [{
        via: scaleGradientStopPosition()
      }],
      /**
       * Gradient Color Stops To Position
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-to-pos": [{
        to: scaleGradientStopPosition()
      }],
      /**
       * Gradient Color Stops From
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-from": [{
        from: scaleColor()
      }],
      /**
       * Gradient Color Stops Via
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-via": [{
        via: scaleColor()
      }],
      /**
       * Gradient Color Stops To
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-to": [{
        to: scaleColor()
      }],
      // ---------------
      // --- Borders ---
      // ---------------
      /**
       * Border Radius
       * @see https://tailwindcss.com/docs/border-radius
       */
      rounded: [{
        rounded: scaleRadius()
      }],
      /**
       * Border Radius Start
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-s": [{
        "rounded-s": scaleRadius()
      }],
      /**
       * Border Radius End
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-e": [{
        "rounded-e": scaleRadius()
      }],
      /**
       * Border Radius Top
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-t": [{
        "rounded-t": scaleRadius()
      }],
      /**
       * Border Radius Right
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-r": [{
        "rounded-r": scaleRadius()
      }],
      /**
       * Border Radius Bottom
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-b": [{
        "rounded-b": scaleRadius()
      }],
      /**
       * Border Radius Left
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-l": [{
        "rounded-l": scaleRadius()
      }],
      /**
       * Border Radius Start Start
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-ss": [{
        "rounded-ss": scaleRadius()
      }],
      /**
       * Border Radius Start End
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-se": [{
        "rounded-se": scaleRadius()
      }],
      /**
       * Border Radius End End
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-ee": [{
        "rounded-ee": scaleRadius()
      }],
      /**
       * Border Radius End Start
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-es": [{
        "rounded-es": scaleRadius()
      }],
      /**
       * Border Radius Top Left
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-tl": [{
        "rounded-tl": scaleRadius()
      }],
      /**
       * Border Radius Top Right
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-tr": [{
        "rounded-tr": scaleRadius()
      }],
      /**
       * Border Radius Bottom Right
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-br": [{
        "rounded-br": scaleRadius()
      }],
      /**
       * Border Radius Bottom Left
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-bl": [{
        "rounded-bl": scaleRadius()
      }],
      /**
       * Border Width
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w": [{
        border: scaleBorderWidth()
      }],
      /**
       * Border Width Inline
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-x": [{
        "border-x": scaleBorderWidth()
      }],
      /**
       * Border Width Block
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-y": [{
        "border-y": scaleBorderWidth()
      }],
      /**
       * Border Width Inline Start
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-s": [{
        "border-s": scaleBorderWidth()
      }],
      /**
       * Border Width Inline End
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-e": [{
        "border-e": scaleBorderWidth()
      }],
      /**
       * Border Width Block Start
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-bs": [{
        "border-bs": scaleBorderWidth()
      }],
      /**
       * Border Width Block End
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-be": [{
        "border-be": scaleBorderWidth()
      }],
      /**
       * Border Width Top
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-t": [{
        "border-t": scaleBorderWidth()
      }],
      /**
       * Border Width Right
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-r": [{
        "border-r": scaleBorderWidth()
      }],
      /**
       * Border Width Bottom
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-b": [{
        "border-b": scaleBorderWidth()
      }],
      /**
       * Border Width Left
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-l": [{
        "border-l": scaleBorderWidth()
      }],
      /**
       * Divide Width X
       * @see https://tailwindcss.com/docs/border-width#between-children
       */
      "divide-x": [{
        "divide-x": scaleBorderWidth()
      }],
      /**
       * Divide Width X Reverse
       * @see https://tailwindcss.com/docs/border-width#between-children
       */
      "divide-x-reverse": ["divide-x-reverse"],
      /**
       * Divide Width Y
       * @see https://tailwindcss.com/docs/border-width#between-children
       */
      "divide-y": [{
        "divide-y": scaleBorderWidth()
      }],
      /**
       * Divide Width Y Reverse
       * @see https://tailwindcss.com/docs/border-width#between-children
       */
      "divide-y-reverse": ["divide-y-reverse"],
      /**
       * Border Style
       * @see https://tailwindcss.com/docs/border-style
       */
      "border-style": [{
        border: [...scaleLineStyle(), "hidden", "none"]
      }],
      /**
       * Divide Style
       * @see https://tailwindcss.com/docs/border-style#setting-the-divider-style
       */
      "divide-style": [{
        divide: [...scaleLineStyle(), "hidden", "none"]
      }],
      /**
       * Border Color
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color": [{
        border: scaleColor()
      }],
      /**
       * Border Color Inline
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-x": [{
        "border-x": scaleColor()
      }],
      /**
       * Border Color Block
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-y": [{
        "border-y": scaleColor()
      }],
      /**
       * Border Color Inline Start
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-s": [{
        "border-s": scaleColor()
      }],
      /**
       * Border Color Inline End
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-e": [{
        "border-e": scaleColor()
      }],
      /**
       * Border Color Block Start
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-bs": [{
        "border-bs": scaleColor()
      }],
      /**
       * Border Color Block End
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-be": [{
        "border-be": scaleColor()
      }],
      /**
       * Border Color Top
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-t": [{
        "border-t": scaleColor()
      }],
      /**
       * Border Color Right
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-r": [{
        "border-r": scaleColor()
      }],
      /**
       * Border Color Bottom
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-b": [{
        "border-b": scaleColor()
      }],
      /**
       * Border Color Left
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-l": [{
        "border-l": scaleColor()
      }],
      /**
       * Divide Color
       * @see https://tailwindcss.com/docs/divide-color
       */
      "divide-color": [{
        divide: scaleColor()
      }],
      /**
       * Outline Style
       * @see https://tailwindcss.com/docs/outline-style
       */
      "outline-style": [{
        outline: [...scaleLineStyle(), "none", "hidden"]
      }],
      /**
       * Outline Offset
       * @see https://tailwindcss.com/docs/outline-offset
       */
      "outline-offset": [{
        "outline-offset": [isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Outline Width
       * @see https://tailwindcss.com/docs/outline-width
       */
      "outline-w": [{
        outline: ["", isNumber, isArbitraryVariableLength, isArbitraryLength]
      }],
      /**
       * Outline Color
       * @see https://tailwindcss.com/docs/outline-color
       */
      "outline-color": [{
        outline: scaleColor()
      }],
      // ---------------
      // --- Effects ---
      // ---------------
      /**
       * Box Shadow
       * @see https://tailwindcss.com/docs/box-shadow
       */
      shadow: [{
        shadow: [
          // Deprecated since Tailwind CSS v4.0.0
          "",
          "none",
          themeShadow,
          isArbitraryVariableShadow,
          isArbitraryShadow
        ]
      }],
      /**
       * Box Shadow Color
       * @see https://tailwindcss.com/docs/box-shadow#setting-the-shadow-color
       */
      "shadow-color": [{
        shadow: scaleColor()
      }],
      /**
       * Inset Box Shadow
       * @see https://tailwindcss.com/docs/box-shadow#adding-an-inset-shadow
       */
      "inset-shadow": [{
        "inset-shadow": ["none", themeInsetShadow, isArbitraryVariableShadow, isArbitraryShadow]
      }],
      /**
       * Inset Box Shadow Color
       * @see https://tailwindcss.com/docs/box-shadow#setting-the-inset-shadow-color
       */
      "inset-shadow-color": [{
        "inset-shadow": scaleColor()
      }],
      /**
       * Ring Width
       * @see https://tailwindcss.com/docs/box-shadow#adding-a-ring
       */
      "ring-w": [{
        ring: scaleBorderWidth()
      }],
      /**
       * Ring Width Inset
       * @see https://v3.tailwindcss.com/docs/ring-width#inset-rings
       * @deprecated since Tailwind CSS v4.0.0
       * @see https://github.com/tailwindlabs/tailwindcss/blob/v4.0.0/packages/tailwindcss/src/utilities.ts#L4158
       */
      "ring-w-inset": ["ring-inset"],
      /**
       * Ring Color
       * @see https://tailwindcss.com/docs/box-shadow#setting-the-ring-color
       */
      "ring-color": [{
        ring: scaleColor()
      }],
      /**
       * Ring Offset Width
       * @see https://v3.tailwindcss.com/docs/ring-offset-width
       * @deprecated since Tailwind CSS v4.0.0
       * @see https://github.com/tailwindlabs/tailwindcss/blob/v4.0.0/packages/tailwindcss/src/utilities.ts#L4158
       */
      "ring-offset-w": [{
        "ring-offset": [isNumber, isArbitraryLength]
      }],
      /**
       * Ring Offset Color
       * @see https://v3.tailwindcss.com/docs/ring-offset-color
       * @deprecated since Tailwind CSS v4.0.0
       * @see https://github.com/tailwindlabs/tailwindcss/blob/v4.0.0/packages/tailwindcss/src/utilities.ts#L4158
       */
      "ring-offset-color": [{
        "ring-offset": scaleColor()
      }],
      /**
       * Inset Ring Width
       * @see https://tailwindcss.com/docs/box-shadow#adding-an-inset-ring
       */
      "inset-ring-w": [{
        "inset-ring": scaleBorderWidth()
      }],
      /**
       * Inset Ring Color
       * @see https://tailwindcss.com/docs/box-shadow#setting-the-inset-ring-color
       */
      "inset-ring-color": [{
        "inset-ring": scaleColor()
      }],
      /**
       * Text Shadow
       * @see https://tailwindcss.com/docs/text-shadow
       */
      "text-shadow": [{
        "text-shadow": ["none", themeTextShadow, isArbitraryVariableShadow, isArbitraryShadow]
      }],
      /**
       * Text Shadow Color
       * @see https://tailwindcss.com/docs/text-shadow#setting-the-shadow-color
       */
      "text-shadow-color": [{
        "text-shadow": scaleColor()
      }],
      /**
       * Opacity
       * @see https://tailwindcss.com/docs/opacity
       */
      opacity: [{
        opacity: [isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Mix Blend Mode
       * @see https://tailwindcss.com/docs/mix-blend-mode
       */
      "mix-blend": [{
        "mix-blend": [...scaleBlendMode(), "plus-darker", "plus-lighter"]
      }],
      /**
       * Background Blend Mode
       * @see https://tailwindcss.com/docs/background-blend-mode
       */
      "bg-blend": [{
        "bg-blend": scaleBlendMode()
      }],
      /**
       * Mask Clip
       * @see https://tailwindcss.com/docs/mask-clip
       */
      "mask-clip": [{
        "mask-clip": ["border", "padding", "content", "fill", "stroke", "view"]
      }, "mask-no-clip"],
      /**
       * Mask Composite
       * @see https://tailwindcss.com/docs/mask-composite
       */
      "mask-composite": [{
        mask: ["add", "subtract", "intersect", "exclude"]
      }],
      /**
       * Mask Image
       * @see https://tailwindcss.com/docs/mask-image
       */
      "mask-image-linear-pos": [{
        "mask-linear": [isNumber]
      }],
      "mask-image-linear-from-pos": [{
        "mask-linear-from": scaleMaskImagePosition()
      }],
      "mask-image-linear-to-pos": [{
        "mask-linear-to": scaleMaskImagePosition()
      }],
      "mask-image-linear-from-color": [{
        "mask-linear-from": scaleColor()
      }],
      "mask-image-linear-to-color": [{
        "mask-linear-to": scaleColor()
      }],
      "mask-image-t-from-pos": [{
        "mask-t-from": scaleMaskImagePosition()
      }],
      "mask-image-t-to-pos": [{
        "mask-t-to": scaleMaskImagePosition()
      }],
      "mask-image-t-from-color": [{
        "mask-t-from": scaleColor()
      }],
      "mask-image-t-to-color": [{
        "mask-t-to": scaleColor()
      }],
      "mask-image-r-from-pos": [{
        "mask-r-from": scaleMaskImagePosition()
      }],
      "mask-image-r-to-pos": [{
        "mask-r-to": scaleMaskImagePosition()
      }],
      "mask-image-r-from-color": [{
        "mask-r-from": scaleColor()
      }],
      "mask-image-r-to-color": [{
        "mask-r-to": scaleColor()
      }],
      "mask-image-b-from-pos": [{
        "mask-b-from": scaleMaskImagePosition()
      }],
      "mask-image-b-to-pos": [{
        "mask-b-to": scaleMaskImagePosition()
      }],
      "mask-image-b-from-color": [{
        "mask-b-from": scaleColor()
      }],
      "mask-image-b-to-color": [{
        "mask-b-to": scaleColor()
      }],
      "mask-image-l-from-pos": [{
        "mask-l-from": scaleMaskImagePosition()
      }],
      "mask-image-l-to-pos": [{
        "mask-l-to": scaleMaskImagePosition()
      }],
      "mask-image-l-from-color": [{
        "mask-l-from": scaleColor()
      }],
      "mask-image-l-to-color": [{
        "mask-l-to": scaleColor()
      }],
      "mask-image-x-from-pos": [{
        "mask-x-from": scaleMaskImagePosition()
      }],
      "mask-image-x-to-pos": [{
        "mask-x-to": scaleMaskImagePosition()
      }],
      "mask-image-x-from-color": [{
        "mask-x-from": scaleColor()
      }],
      "mask-image-x-to-color": [{
        "mask-x-to": scaleColor()
      }],
      "mask-image-y-from-pos": [{
        "mask-y-from": scaleMaskImagePosition()
      }],
      "mask-image-y-to-pos": [{
        "mask-y-to": scaleMaskImagePosition()
      }],
      "mask-image-y-from-color": [{
        "mask-y-from": scaleColor()
      }],
      "mask-image-y-to-color": [{
        "mask-y-to": scaleColor()
      }],
      "mask-image-radial": [{
        "mask-radial": [isArbitraryVariable, isArbitraryValue]
      }],
      "mask-image-radial-from-pos": [{
        "mask-radial-from": scaleMaskImagePosition()
      }],
      "mask-image-radial-to-pos": [{
        "mask-radial-to": scaleMaskImagePosition()
      }],
      "mask-image-radial-from-color": [{
        "mask-radial-from": scaleColor()
      }],
      "mask-image-radial-to-color": [{
        "mask-radial-to": scaleColor()
      }],
      "mask-image-radial-shape": [{
        "mask-radial": ["circle", "ellipse"]
      }],
      "mask-image-radial-size": [{
        "mask-radial": [{
          closest: ["side", "corner"],
          farthest: ["side", "corner"]
        }]
      }],
      "mask-image-radial-pos": [{
        "mask-radial-at": scalePosition()
      }],
      "mask-image-conic-pos": [{
        "mask-conic": [isNumber]
      }],
      "mask-image-conic-from-pos": [{
        "mask-conic-from": scaleMaskImagePosition()
      }],
      "mask-image-conic-to-pos": [{
        "mask-conic-to": scaleMaskImagePosition()
      }],
      "mask-image-conic-from-color": [{
        "mask-conic-from": scaleColor()
      }],
      "mask-image-conic-to-color": [{
        "mask-conic-to": scaleColor()
      }],
      /**
       * Mask Mode
       * @see https://tailwindcss.com/docs/mask-mode
       */
      "mask-mode": [{
        mask: ["alpha", "luminance", "match"]
      }],
      /**
       * Mask Origin
       * @see https://tailwindcss.com/docs/mask-origin
       */
      "mask-origin": [{
        "mask-origin": ["border", "padding", "content", "fill", "stroke", "view"]
      }],
      /**
       * Mask Position
       * @see https://tailwindcss.com/docs/mask-position
       */
      "mask-position": [{
        mask: scaleBgPosition()
      }],
      /**
       * Mask Repeat
       * @see https://tailwindcss.com/docs/mask-repeat
       */
      "mask-repeat": [{
        mask: scaleBgRepeat()
      }],
      /**
       * Mask Size
       * @see https://tailwindcss.com/docs/mask-size
       */
      "mask-size": [{
        mask: scaleBgSize()
      }],
      /**
       * Mask Type
       * @see https://tailwindcss.com/docs/mask-type
       */
      "mask-type": [{
        "mask-type": ["alpha", "luminance"]
      }],
      /**
       * Mask Image
       * @see https://tailwindcss.com/docs/mask-image
       */
      "mask-image": [{
        mask: ["none", isArbitraryVariable, isArbitraryValue]
      }],
      // ---------------
      // --- Filters ---
      // ---------------
      /**
       * Filter
       * @see https://tailwindcss.com/docs/filter
       */
      filter: [{
        filter: [
          // Deprecated since Tailwind CSS v3.0.0
          "",
          "none",
          isArbitraryVariable,
          isArbitraryValue
        ]
      }],
      /**
       * Blur
       * @see https://tailwindcss.com/docs/blur
       */
      blur: [{
        blur: scaleBlur()
      }],
      /**
       * Brightness
       * @see https://tailwindcss.com/docs/brightness
       */
      brightness: [{
        brightness: [isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Contrast
       * @see https://tailwindcss.com/docs/contrast
       */
      contrast: [{
        contrast: [isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Drop Shadow
       * @see https://tailwindcss.com/docs/drop-shadow
       */
      "drop-shadow": [{
        "drop-shadow": [
          // Deprecated since Tailwind CSS v4.0.0
          "",
          "none",
          themeDropShadow,
          isArbitraryVariableShadow,
          isArbitraryShadow
        ]
      }],
      /**
       * Drop Shadow Color
       * @see https://tailwindcss.com/docs/filter-drop-shadow#setting-the-shadow-color
       */
      "drop-shadow-color": [{
        "drop-shadow": scaleColor()
      }],
      /**
       * Grayscale
       * @see https://tailwindcss.com/docs/grayscale
       */
      grayscale: [{
        grayscale: ["", isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Hue Rotate
       * @see https://tailwindcss.com/docs/hue-rotate
       */
      "hue-rotate": [{
        "hue-rotate": [isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Invert
       * @see https://tailwindcss.com/docs/invert
       */
      invert: [{
        invert: ["", isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Saturate
       * @see https://tailwindcss.com/docs/saturate
       */
      saturate: [{
        saturate: [isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Sepia
       * @see https://tailwindcss.com/docs/sepia
       */
      sepia: [{
        sepia: ["", isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Backdrop Filter
       * @see https://tailwindcss.com/docs/backdrop-filter
       */
      "backdrop-filter": [{
        "backdrop-filter": [
          // Deprecated since Tailwind CSS v3.0.0
          "",
          "none",
          isArbitraryVariable,
          isArbitraryValue
        ]
      }],
      /**
       * Backdrop Blur
       * @see https://tailwindcss.com/docs/backdrop-blur
       */
      "backdrop-blur": [{
        "backdrop-blur": scaleBlur()
      }],
      /**
       * Backdrop Brightness
       * @see https://tailwindcss.com/docs/backdrop-brightness
       */
      "backdrop-brightness": [{
        "backdrop-brightness": [isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Backdrop Contrast
       * @see https://tailwindcss.com/docs/backdrop-contrast
       */
      "backdrop-contrast": [{
        "backdrop-contrast": [isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Backdrop Grayscale
       * @see https://tailwindcss.com/docs/backdrop-grayscale
       */
      "backdrop-grayscale": [{
        "backdrop-grayscale": ["", isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Backdrop Hue Rotate
       * @see https://tailwindcss.com/docs/backdrop-hue-rotate
       */
      "backdrop-hue-rotate": [{
        "backdrop-hue-rotate": [isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Backdrop Invert
       * @see https://tailwindcss.com/docs/backdrop-invert
       */
      "backdrop-invert": [{
        "backdrop-invert": ["", isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Backdrop Opacity
       * @see https://tailwindcss.com/docs/backdrop-opacity
       */
      "backdrop-opacity": [{
        "backdrop-opacity": [isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Backdrop Saturate
       * @see https://tailwindcss.com/docs/backdrop-saturate
       */
      "backdrop-saturate": [{
        "backdrop-saturate": [isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Backdrop Sepia
       * @see https://tailwindcss.com/docs/backdrop-sepia
       */
      "backdrop-sepia": [{
        "backdrop-sepia": ["", isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      // --------------
      // --- Tables ---
      // --------------
      /**
       * Border Collapse
       * @see https://tailwindcss.com/docs/border-collapse
       */
      "border-collapse": [{
        border: ["collapse", "separate"]
      }],
      /**
       * Border Spacing
       * @see https://tailwindcss.com/docs/border-spacing
       */
      "border-spacing": [{
        "border-spacing": scaleUnambiguousSpacing()
      }],
      /**
       * Border Spacing X
       * @see https://tailwindcss.com/docs/border-spacing
       */
      "border-spacing-x": [{
        "border-spacing-x": scaleUnambiguousSpacing()
      }],
      /**
       * Border Spacing Y
       * @see https://tailwindcss.com/docs/border-spacing
       */
      "border-spacing-y": [{
        "border-spacing-y": scaleUnambiguousSpacing()
      }],
      /**
       * Table Layout
       * @see https://tailwindcss.com/docs/table-layout
       */
      "table-layout": [{
        table: ["auto", "fixed"]
      }],
      /**
       * Caption Side
       * @see https://tailwindcss.com/docs/caption-side
       */
      caption: [{
        caption: ["top", "bottom"]
      }],
      // ---------------------------------
      // --- Transitions and Animation ---
      // ---------------------------------
      /**
       * Transition Property
       * @see https://tailwindcss.com/docs/transition-property
       */
      transition: [{
        transition: ["", "all", "colors", "opacity", "shadow", "transform", "none", isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Transition Behavior
       * @see https://tailwindcss.com/docs/transition-behavior
       */
      "transition-behavior": [{
        transition: ["normal", "discrete"]
      }],
      /**
       * Transition Duration
       * @see https://tailwindcss.com/docs/transition-duration
       */
      duration: [{
        duration: [isNumber, "initial", isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Transition Timing Function
       * @see https://tailwindcss.com/docs/transition-timing-function
       */
      ease: [{
        ease: ["linear", "initial", themeEase, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Transition Delay
       * @see https://tailwindcss.com/docs/transition-delay
       */
      delay: [{
        delay: [isNumber, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Animation
       * @see https://tailwindcss.com/docs/animation
       */
      animate: [{
        animate: ["none", themeAnimate, isArbitraryVariable, isArbitraryValue]
      }],
      // ------------------
      // --- Transforms ---
      // ------------------
      /**
       * Backface Visibility
       * @see https://tailwindcss.com/docs/backface-visibility
       */
      backface: [{
        backface: ["hidden", "visible"]
      }],
      /**
       * Perspective
       * @see https://tailwindcss.com/docs/perspective
       */
      perspective: [{
        perspective: [themePerspective, isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Perspective Origin
       * @see https://tailwindcss.com/docs/perspective-origin
       */
      "perspective-origin": [{
        "perspective-origin": scalePositionWithArbitrary()
      }],
      /**
       * Rotate
       * @see https://tailwindcss.com/docs/rotate
       */
      rotate: [{
        rotate: scaleRotate()
      }],
      /**
       * Rotate X
       * @see https://tailwindcss.com/docs/rotate
       */
      "rotate-x": [{
        "rotate-x": scaleRotate()
      }],
      /**
       * Rotate Y
       * @see https://tailwindcss.com/docs/rotate
       */
      "rotate-y": [{
        "rotate-y": scaleRotate()
      }],
      /**
       * Rotate Z
       * @see https://tailwindcss.com/docs/rotate
       */
      "rotate-z": [{
        "rotate-z": scaleRotate()
      }],
      /**
       * Scale
       * @see https://tailwindcss.com/docs/scale
       */
      scale: [{
        scale: scaleScale()
      }],
      /**
       * Scale X
       * @see https://tailwindcss.com/docs/scale
       */
      "scale-x": [{
        "scale-x": scaleScale()
      }],
      /**
       * Scale Y
       * @see https://tailwindcss.com/docs/scale
       */
      "scale-y": [{
        "scale-y": scaleScale()
      }],
      /**
       * Scale Z
       * @see https://tailwindcss.com/docs/scale
       */
      "scale-z": [{
        "scale-z": scaleScale()
      }],
      /**
       * Scale 3D
       * @see https://tailwindcss.com/docs/scale
       */
      "scale-3d": ["scale-3d"],
      /**
       * Skew
       * @see https://tailwindcss.com/docs/skew
       */
      skew: [{
        skew: scaleSkew()
      }],
      /**
       * Skew X
       * @see https://tailwindcss.com/docs/skew
       */
      "skew-x": [{
        "skew-x": scaleSkew()
      }],
      /**
       * Skew Y
       * @see https://tailwindcss.com/docs/skew
       */
      "skew-y": [{
        "skew-y": scaleSkew()
      }],
      /**
       * Transform
       * @see https://tailwindcss.com/docs/transform
       */
      transform: [{
        transform: [isArbitraryVariable, isArbitraryValue, "", "none", "gpu", "cpu"]
      }],
      /**
       * Transform Origin
       * @see https://tailwindcss.com/docs/transform-origin
       */
      "transform-origin": [{
        origin: scalePositionWithArbitrary()
      }],
      /**
       * Transform Style
       * @see https://tailwindcss.com/docs/transform-style
       */
      "transform-style": [{
        transform: ["3d", "flat"]
      }],
      /**
       * Translate
       * @see https://tailwindcss.com/docs/translate
       */
      translate: [{
        translate: scaleTranslate()
      }],
      /**
       * Translate X
       * @see https://tailwindcss.com/docs/translate
       */
      "translate-x": [{
        "translate-x": scaleTranslate()
      }],
      /**
       * Translate Y
       * @see https://tailwindcss.com/docs/translate
       */
      "translate-y": [{
        "translate-y": scaleTranslate()
      }],
      /**
       * Translate Z
       * @see https://tailwindcss.com/docs/translate
       */
      "translate-z": [{
        "translate-z": scaleTranslate()
      }],
      /**
       * Translate None
       * @see https://tailwindcss.com/docs/translate
       */
      "translate-none": ["translate-none"],
      /**
       * Zoom
       * @see https://tailwindcss.com/docs/zoom
       */
      zoom: [{
        zoom: [isInteger, isArbitraryVariable, isArbitraryValue]
      }],
      // ---------------------
      // --- Interactivity ---
      // ---------------------
      /**
       * Accent Color
       * @see https://tailwindcss.com/docs/accent-color
       */
      accent: [{
        accent: scaleColor()
      }],
      /**
       * Appearance
       * @see https://tailwindcss.com/docs/appearance
       */
      appearance: [{
        appearance: ["none", "auto"]
      }],
      /**
       * Caret Color
       * @see https://tailwindcss.com/docs/just-in-time-mode#caret-color-utilities
       */
      "caret-color": [{
        caret: scaleColor()
      }],
      /**
       * Color Scheme
       * @see https://tailwindcss.com/docs/color-scheme
       */
      "color-scheme": [{
        scheme: ["normal", "dark", "light", "light-dark", "only-dark", "only-light"]
      }],
      /**
       * Cursor
       * @see https://tailwindcss.com/docs/cursor
       */
      cursor: [{
        cursor: ["auto", "default", "pointer", "wait", "text", "move", "help", "not-allowed", "none", "context-menu", "progress", "cell", "crosshair", "vertical-text", "alias", "copy", "no-drop", "grab", "grabbing", "all-scroll", "col-resize", "row-resize", "n-resize", "e-resize", "s-resize", "w-resize", "ne-resize", "nw-resize", "se-resize", "sw-resize", "ew-resize", "ns-resize", "nesw-resize", "nwse-resize", "zoom-in", "zoom-out", isArbitraryVariable, isArbitraryValue]
      }],
      /**
       * Field Sizing
       * @see https://tailwindcss.com/docs/field-sizing
       */
      "field-sizing": [{
        "field-sizing": ["fixed", "content"]
      }],
      /**
       * Pointer Events
       * @see https://tailwindcss.com/docs/pointer-events
       */
      "pointer-events": [{
        "pointer-events": ["auto", "none"]
      }],
      /**
       * Resize
       * @see https://tailwindcss.com/docs/resize
       */
      resize: [{
        resize: ["none", "", "y", "x"]
      }],
      /**
       * Scroll Behavior
       * @see https://tailwindcss.com/docs/scroll-behavior
       */
      "scroll-behavior": [{
        scroll: ["auto", "smooth"]
      }],
      /**
       * Scrollbar Thumb Color
       * @see https://tailwindcss.com/docs/scrollbar-color
       */
      "scrollbar-thumb-color": [{
        "scrollbar-thumb": scaleColor()
      }],
      /**
       * Scrollbar Track Color
       * @see https://tailwindcss.com/docs/scrollbar-color
       */
      "scrollbar-track-color": [{
        "scrollbar-track": scaleColor()
      }],
      /**
       * Scrollbar Gutter
       * @see https://tailwindcss.com/docs/scrollbar-gutter
       */
      "scrollbar-gutter": [{
        "scrollbar-gutter": ["auto", "stable", "both"]
      }],
      /**
       * Scrollbar Width
       * @see https://tailwindcss.com/docs/scrollbar-width
       */
      "scrollbar-w": [{
        scrollbar: ["auto", "thin", "none"]
      }],
      /**
       * Scroll Margin
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-m": [{
        "scroll-m": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Margin Inline
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mx": [{
        "scroll-mx": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Margin Block
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-my": [{
        "scroll-my": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Margin Inline Start
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-ms": [{
        "scroll-ms": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Margin Inline End
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-me": [{
        "scroll-me": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Margin Block Start
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mbs": [{
        "scroll-mbs": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Margin Block End
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mbe": [{
        "scroll-mbe": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Margin Top
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mt": [{
        "scroll-mt": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Margin Right
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mr": [{
        "scroll-mr": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Margin Bottom
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mb": [{
        "scroll-mb": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Margin Left
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-ml": [{
        "scroll-ml": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Padding
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-p": [{
        "scroll-p": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Padding Inline
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-px": [{
        "scroll-px": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Padding Block
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-py": [{
        "scroll-py": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Padding Inline Start
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-ps": [{
        "scroll-ps": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Padding Inline End
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pe": [{
        "scroll-pe": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Padding Block Start
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pbs": [{
        "scroll-pbs": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Padding Block End
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pbe": [{
        "scroll-pbe": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Padding Top
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pt": [{
        "scroll-pt": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Padding Right
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pr": [{
        "scroll-pr": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Padding Bottom
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pb": [{
        "scroll-pb": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Padding Left
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pl": [{
        "scroll-pl": scaleUnambiguousSpacing()
      }],
      /**
       * Scroll Snap Align
       * @see https://tailwindcss.com/docs/scroll-snap-align
       */
      "snap-align": [{
        snap: ["start", "end", "center", "align-none"]
      }],
      /**
       * Scroll Snap Stop
       * @see https://tailwindcss.com/docs/scroll-snap-stop
       */
      "snap-stop": [{
        snap: ["normal", "always"]
      }],
      /**
       * Scroll Snap Type
       * @see https://tailwindcss.com/docs/scroll-snap-type
       */
      "snap-type": [{
        snap: ["none", "x", "y", "both"]
      }],
      /**
       * Scroll Snap Type Strictness
       * @see https://tailwindcss.com/docs/scroll-snap-type
       */
      "snap-strictness": [{
        snap: ["mandatory", "proximity"]
      }],
      /**
       * Touch Action
       * @see https://tailwindcss.com/docs/touch-action
       */
      touch: [{
        touch: ["auto", "none", "manipulation"]
      }],
      /**
       * Touch Action X
       * @see https://tailwindcss.com/docs/touch-action
       */
      "touch-x": [{
        "touch-pan": ["x", "left", "right"]
      }],
      /**
       * Touch Action Y
       * @see https://tailwindcss.com/docs/touch-action
       */
      "touch-y": [{
        "touch-pan": ["y", "up", "down"]
      }],
      /**
       * Touch Action Pinch Zoom
       * @see https://tailwindcss.com/docs/touch-action
       */
      "touch-pz": ["touch-pinch-zoom"],
      /**
       * User Select
       * @see https://tailwindcss.com/docs/user-select
       */
      select: [{
        select: ["none", "text", "all", "auto"]
      }],
      /**
       * Will Change
       * @see https://tailwindcss.com/docs/will-change
       */
      "will-change": [{
        "will-change": ["auto", "scroll", "contents", "transform", isArbitraryVariable, isArbitraryValue]
      }],
      // -----------
      // --- SVG ---
      // -----------
      /**
       * Fill
       * @see https://tailwindcss.com/docs/fill
       */
      fill: [{
        fill: ["none", ...scaleColor()]
      }],
      /**
       * Stroke Width
       * @see https://tailwindcss.com/docs/stroke-width
       */
      "stroke-w": [{
        stroke: [isNumber, isArbitraryVariableLength, isArbitraryLength, isArbitraryNumber]
      }],
      /**
       * Stroke
       * @see https://tailwindcss.com/docs/stroke
       */
      stroke: [{
        stroke: ["none", ...scaleColor()]
      }],
      // ---------------------
      // --- Accessibility ---
      // ---------------------
      /**
       * Forced Color Adjust
       * @see https://tailwindcss.com/docs/forced-color-adjust
       */
      "forced-color-adjust": [{
        "forced-color-adjust": ["auto", "none"]
      }]
    },
    conflictingClassGroups: {
      "container-named": ["container-type"],
      overflow: ["overflow-x", "overflow-y"],
      overscroll: ["overscroll-x", "overscroll-y"],
      inset: ["inset-x", "inset-y", "inset-bs", "inset-be", "start", "end", "top", "right", "bottom", "left"],
      "inset-x": ["right", "left"],
      "inset-y": ["top", "bottom"],
      flex: ["basis", "grow", "shrink"],
      gap: ["gap-x", "gap-y"],
      p: ["px", "py", "ps", "pe", "pbs", "pbe", "pt", "pr", "pb", "pl"],
      px: ["pr", "pl"],
      py: ["pt", "pb"],
      m: ["mx", "my", "ms", "me", "mbs", "mbe", "mt", "mr", "mb", "ml"],
      mx: ["mr", "ml"],
      my: ["mt", "mb"],
      size: ["w", "h"],
      "font-size": ["leading"],
      "fvn-normal": ["fvn-ordinal", "fvn-slashed-zero", "fvn-figure", "fvn-spacing", "fvn-fraction"],
      "fvn-ordinal": ["fvn-normal"],
      "fvn-slashed-zero": ["fvn-normal"],
      "fvn-figure": ["fvn-normal"],
      "fvn-spacing": ["fvn-normal"],
      "fvn-fraction": ["fvn-normal"],
      "line-clamp": ["display", "overflow"],
      rounded: ["rounded-s", "rounded-e", "rounded-t", "rounded-r", "rounded-b", "rounded-l", "rounded-ss", "rounded-se", "rounded-ee", "rounded-es", "rounded-tl", "rounded-tr", "rounded-br", "rounded-bl"],
      "rounded-s": ["rounded-ss", "rounded-es"],
      "rounded-e": ["rounded-se", "rounded-ee"],
      "rounded-t": ["rounded-tl", "rounded-tr"],
      "rounded-r": ["rounded-tr", "rounded-br"],
      "rounded-b": ["rounded-br", "rounded-bl"],
      "rounded-l": ["rounded-tl", "rounded-bl"],
      "border-spacing": ["border-spacing-x", "border-spacing-y"],
      "border-w": ["border-w-x", "border-w-y", "border-w-s", "border-w-e", "border-w-bs", "border-w-be", "border-w-t", "border-w-r", "border-w-b", "border-w-l"],
      "border-w-x": ["border-w-r", "border-w-l"],
      "border-w-y": ["border-w-t", "border-w-b"],
      "border-color": ["border-color-x", "border-color-y", "border-color-s", "border-color-e", "border-color-bs", "border-color-be", "border-color-t", "border-color-r", "border-color-b", "border-color-l"],
      "border-color-x": ["border-color-r", "border-color-l"],
      "border-color-y": ["border-color-t", "border-color-b"],
      translate: ["translate-x", "translate-y", "translate-none"],
      "translate-none": ["translate", "translate-x", "translate-y", "translate-z"],
      "scroll-m": ["scroll-mx", "scroll-my", "scroll-ms", "scroll-me", "scroll-mbs", "scroll-mbe", "scroll-mt", "scroll-mr", "scroll-mb", "scroll-ml"],
      "scroll-mx": ["scroll-mr", "scroll-ml"],
      "scroll-my": ["scroll-mt", "scroll-mb"],
      "scroll-p": ["scroll-px", "scroll-py", "scroll-ps", "scroll-pe", "scroll-pbs", "scroll-pbe", "scroll-pt", "scroll-pr", "scroll-pb", "scroll-pl"],
      "scroll-px": ["scroll-pr", "scroll-pl"],
      "scroll-py": ["scroll-pt", "scroll-pb"],
      touch: ["touch-x", "touch-y", "touch-pz"],
      "touch-x": ["touch"],
      "touch-y": ["touch"],
      "touch-pz": ["touch"]
    },
    conflictingClassGroupModifiers: {
      "font-size": ["leading"]
    },
    postfixLookupClassGroups: ["container-type"],
    orderSensitiveModifiers: ["*", "**", "after", "backdrop", "before", "details-content", "file", "first-letter", "first-line", "marker", "placeholder", "selection"]
  };
};
var twMerge = /* @__PURE__ */ createTailwindMerge(getDefaultConfig);

// ../../../packages/console/client/dist/console-utils/cn.js
function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// ../../../packages/console/client/dist/orchestration/OrchestrationRunsPage.js
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "/esm/react~jsx-runtime.mjs?v=ms2oc1s3";
import { useCallback as useCallback2, useState as useState2 } from "/esm/react.mjs?v=ms2oc1s3";

// pages/sandboxTransport.ts
function getSandboxApiBase() {
  if (typeof localStorage === "undefined") {
    return typeof window !== "undefined" ? window.location.origin : "";
  }
  const stored = localStorage.getItem("zhin_api_base")?.trim();
  if (stored) return stored.replace(/\/+$/u, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}
function getSandboxBearerToken() {
  if (typeof window !== "undefined") {
    const runtime = window.__ZHIN_API_TOKEN?.trim();
    if (runtime) return runtime;
  }
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem("zhin_api_token")?.trim() || localStorage.getItem("HTTP_TOKEN")?.trim() || localStorage.getItem("zhin_http_token")?.trim() || (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("zhin_api_token")?.trim() : "") || "";
}
function buildSandboxWebSocketUrl(base) {
  const apiBase = (base ?? getSandboxApiBase()).replace(/\/+$/u, "");
  const origin = apiBase || (typeof window !== "undefined" ? window.location.origin : "http://localhost");
  const wsUrl = new URL("/sandbox", `${origin}/`);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  const token = getSandboxBearerToken();
  if (token) wsUrl.searchParams.set("token", token);
  return wsUrl.href;
}

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/createLucideIcon.js
import { forwardRef as forwardRef2, createElement as createElement2 } from "/esm/react.mjs?v=ms2oc1s3";

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/shared/src/utils.js
var toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
var toCamelCase = (string) => string.replace(
  /^([A-Z])|[\s-_]+(\w)/g,
  (match, p1, p2) => p2 ? p2.toUpperCase() : p1.toLowerCase()
);
var toPascalCase = (string) => {
  const camelCase = toCamelCase(string);
  return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
};
var mergeClasses = (...classes) => classes.filter((className, index, array) => {
  return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();
var hasA11yProp = (props) => {
  for (const prop in props) {
    if (prop.startsWith("aria-") || prop === "role" || prop === "title") {
      return true;
    }
  }
};

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/Icon.js
import { forwardRef, createElement } from "/esm/react.mjs?v=ms2oc1s3";

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/defaultAttributes.js
var defaultAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/Icon.js
var Icon = forwardRef(
  ({
    color = "currentColor",
    size = 24,
    strokeWidth = 2,
    absoluteStrokeWidth,
    className = "",
    children,
    iconNode,
    ...rest
  }, ref) => createElement(
    "svg",
    {
      ref,
      ...defaultAttributes,
      width: size,
      height: size,
      stroke: color,
      strokeWidth: absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size) : strokeWidth,
      className: mergeClasses("lucide", className),
      ...!children && !hasA11yProp(rest) && { "aria-hidden": "true" },
      ...rest
    },
    [
      ...iconNode.map(([tag, attrs]) => createElement(tag, attrs)),
      ...Array.isArray(children) ? children : [children]
    ]
  )
);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/createLucideIcon.js
var createLucideIcon = (iconName, iconNode) => {
  const Component = forwardRef2(
    ({ className, ...props }, ref) => createElement2(Icon, {
      ref,
      iconNode,
      className: mergeClasses(
        `lucide-${toKebabCase(toPascalCase(iconName))}`,
        `lucide-${iconName}`,
        className
      ),
      ...props
    })
  );
  Component.displayName = toPascalCase(iconName);
  return Component;
};

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/bell.js
var __iconNode = [
  ["path", { d: "M10.268 21a2 2 0 0 0 3.464 0", key: "vwvbt9" }],
  [
    "path",
    {
      d: "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",
      key: "11g9vi"
    }
  ]
];
var Bell = createLucideIcon("bell", __iconNode);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/bot.js
var __iconNode2 = [
  ["path", { d: "M12 8V4H8", key: "hb8ula" }],
  ["rect", { width: "16", height: "12", x: "4", y: "8", rx: "2", key: "enze0r" }],
  ["path", { d: "M2 14h2", key: "vft8re" }],
  ["path", { d: "M20 14h2", key: "4cs60a" }],
  ["path", { d: "M15 13v2", key: "1xurst" }],
  ["path", { d: "M9 13v2", key: "rq6x2g" }]
];
var Bot = createLucideIcon("bot", __iconNode2);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/check.js
var __iconNode3 = [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]];
var Check = createLucideIcon("check", __iconNode3);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/hash.js
var __iconNode4 = [
  ["line", { x1: "4", x2: "20", y1: "9", y2: "9", key: "4lhtct" }],
  ["line", { x1: "4", x2: "20", y1: "15", y2: "15", key: "vyu0kd" }],
  ["line", { x1: "10", x2: "8", y1: "3", y2: "21", key: "1ggp8o" }],
  ["line", { x1: "16", x2: "14", y1: "3", y2: "21", key: "weycgp" }]
];
var Hash = createLucideIcon("hash", __iconNode4);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/image.js
var __iconNode5 = [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", ry: "2", key: "1m3agn" }],
  ["circle", { cx: "9", cy: "9", r: "2", key: "af1f0g" }],
  ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21", key: "1xmnt7" }]
];
var Image = createLucideIcon("image", __iconNode5);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/info.js
var __iconNode6 = [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "M12 16v-4", key: "1dtifu" }],
  ["path", { d: "M12 8h.01", key: "e9boi3" }]
];
var Info = createLucideIcon("info", __iconNode6);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/message-square.js
var __iconNode7 = [
  ["path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", key: "1lielz" }]
];
var MessageSquare = createLucideIcon("message-square", __iconNode7);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/music.js
var __iconNode8 = [
  ["path", { d: "M9 18V5l12-2v13", key: "1jmyc2" }],
  ["circle", { cx: "6", cy: "18", r: "3", key: "fqmcym" }],
  ["circle", { cx: "18", cy: "16", r: "3", key: "1hluhg" }]
];
var Music = createLucideIcon("music", __iconNode8);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/search.js
var __iconNode9 = [
  ["path", { d: "m21 21-4.34-4.34", key: "14j7rj" }],
  ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }]
];
var Search = createLucideIcon("search", __iconNode9);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/send.js
var __iconNode10 = [
  [
    "path",
    {
      d: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z",
      key: "1ffxy3"
    }
  ],
  ["path", { d: "m21.854 2.147-10.94 10.939", key: "12cjpa" }]
];
var Send = createLucideIcon("send", __iconNode10);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/smile.js
var __iconNode11 = [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "M8 14s1.5 2 4 2 4-2 4-2", key: "1y1vjs" }],
  ["line", { x1: "9", x2: "9.01", y1: "9", y2: "9", key: "yxxnd0" }],
  ["line", { x1: "15", x2: "15.01", y1: "9", y2: "9", key: "1p4y9e" }]
];
var Smile = createLucideIcon("smile", __iconNode11);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/trash-2.js
var __iconNode12 = [
  ["path", { d: "M3 6h18", key: "d0wm0j" }],
  ["path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", key: "4alrt4" }],
  ["path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", key: "v07s0e" }],
  ["line", { x1: "10", x2: "10", y1: "11", y2: "17", key: "1uufr5" }],
  ["line", { x1: "14", x2: "14", y1: "11", y2: "17", key: "xtxkd" }]
];
var Trash2 = createLucideIcon("trash-2", __iconNode12);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/user-plus.js
var __iconNode13 = [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", key: "1yyitq" }],
  ["circle", { cx: "9", cy: "7", r: "4", key: "nufk8" }],
  ["line", { x1: "19", x2: "19", y1: "8", y2: "14", key: "1bvyxn" }],
  ["line", { x1: "22", x2: "16", y1: "11", y2: "11", key: "1shjgl" }]
];
var UserPlus = createLucideIcon("user-plus", __iconNode13);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/user.js
var __iconNode14 = [
  ["path", { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", key: "975kel" }],
  ["circle", { cx: "12", cy: "7", r: "4", key: "17ys0d" }]
];
var User = createLucideIcon("user", __iconNode14);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/users.js
var __iconNode15 = [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", key: "1yyitq" }],
  ["path", { d: "M16 3.128a4 4 0 0 1 0 7.744", key: "16gr8j" }],
  ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87", key: "kshegd" }],
  ["circle", { cx: "9", cy: "7", r: "4", key: "nufk8" }]
];
var Users = createLucideIcon("users", __iconNode15);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/video.js
var __iconNode16 = [
  [
    "path",
    {
      d: "m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5",
      key: "ftymec"
    }
  ],
  ["rect", { x: "2", y: "6", width: "14", height: "12", rx: "2", key: "158x01" }]
];
var Video = createLucideIcon("video", __iconNode16);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/wifi-off.js
var __iconNode17 = [
  ["path", { d: "M12 20h.01", key: "zekei9" }],
  ["path", { d: "M8.5 16.429a5 5 0 0 1 7 0", key: "1bycff" }],
  ["path", { d: "M5 12.859a10 10 0 0 1 5.17-2.69", key: "1dl1wf" }],
  ["path", { d: "M19 12.859a10 10 0 0 0-2.007-1.523", key: "4k23kn" }],
  ["path", { d: "M2 8.82a15 15 0 0 1 4.177-2.643", key: "1grhjp" }],
  ["path", { d: "M22 8.82a15 15 0 0 0-11.288-3.764", key: "z3jwby" }],
  ["path", { d: "m2 2 20 20", key: "1ooewy" }]
];
var WifiOff = createLucideIcon("wifi-off", __iconNode17);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/wifi.js
var __iconNode18 = [
  ["path", { d: "M12 20h.01", key: "zekei9" }],
  ["path", { d: "M2 8.82a15 15 0 0 1 20 0", key: "dnpr2z" }],
  ["path", { d: "M5 12.859a10 10 0 0 1 14 0", key: "1x1e6c" }],
  ["path", { d: "M8.5 16.429a5 5 0 0 1 7 0", key: "1bycff" }]
];
var Wifi = createLucideIcon("wifi", __iconNode18);

// ../../../node_modules/.pnpm/lucide-react@0.525.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/x.js
var __iconNode19 = [
  ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
  ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
];
var X = createLucideIcon("x", __iconNode19);

// pages/RichTextEditor.tsx
import { useRef as useRef2, forwardRef as forwardRef3, useImperativeHandle } from "/esm/react.mjs?v=ms2oc1s3";
import { jsx } from "/esm/react~jsx-runtime.mjs?v=ms2oc1s3";
var RichTextEditor = forwardRef3(
  ({ placeholder = "\u8F93\u5165\u6D88\u606F...", onSend, onChange, onAtTrigger, minHeight = "44px", maxHeight = "200px" }, ref) => {
    const editorRef = useRef2(null);
    const atTriggerTextRef = useRef2(null);
    const parseEditorContent = () => {
      if (!editorRef.current) return { text: "", segments: [] };
      let text = "";
      const segments = [];
      const nodes = Array.from(editorRef.current.childNodes);
      for (const node of nodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const textContent = node.textContent || "";
          if (textContent) {
            text += textContent;
            segments.push({ type: "text", data: { text: textContent } });
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node;
          if (el.classList.contains("editor-face")) {
            const faceId = el.dataset.id;
            text += `[face:${faceId}]`;
            segments.push({ type: "face", data: { id: Number(faceId) } });
          } else if (el.classList.contains("editor-image")) {
            const imageUrl = el.dataset.url;
            text += `[image:${imageUrl}]`;
            segments.push({ type: "image", data: { url: imageUrl } });
          } else if (el.classList.contains("editor-video")) {
            const u = el.dataset.url || "";
            text += `[video:${u}]`;
            segments.push({ type: "video", data: { url: u } });
          } else if (el.classList.contains("editor-audio")) {
            const u = el.dataset.url || "";
            text += `[audio:${u}]`;
            segments.push({ type: "audio", data: { url: u } });
          } else if (el.classList.contains("editor-at")) {
            const name = el.dataset.name;
            const id = el.dataset.id;
            text += `[@${name}]`;
            segments.push({
              type: "mention",
              data: id ? { target: id, name } : { target: name, name }
            });
          } else if (el.tagName === "BR") {
            text += "\n";
          }
        }
      }
      return { text, segments };
    };
    const insertFace = (faceId) => {
      if (!editorRef.current) return;
      const img = document.createElement("img");
      img.src = `https://face.viki.moe/apng/${faceId}.png`;
      img.alt = `[face:${faceId}]`;
      img.dataset.type = "face";
      img.dataset.id = String(faceId);
      img.className = "editor-face";
      insertNodeAtCursor(img);
      handleChange();
    };
    const insertImage = (url) => {
      if (!editorRef.current || !url.trim()) return;
      const img = document.createElement("img");
      img.src = url.trim();
      img.alt = `[image:${url.trim()}]`;
      img.dataset.type = "image";
      img.dataset.url = url.trim();
      img.className = "editor-image";
      insertNodeAtCursor(img);
      handleChange();
    };
    const insertVideo = (url) => {
      if (!editorRef.current || !url.trim()) return;
      const u = url.trim();
      const span = document.createElement("span");
      span.className = "editor-video";
      span.dataset.url = u;
      span.contentEditable = "false";
      span.textContent = "\u{1F4F9} \u89C6\u9891";
      insertNodeAtCursor(span);
      handleChange();
    };
    const insertAudio = (url) => {
      if (!editorRef.current || !url.trim()) return;
      const u = url.trim();
      const span = document.createElement("span");
      span.className = "editor-audio";
      span.dataset.url = u;
      span.contentEditable = "false";
      span.textContent = "\u{1F3B5} \u97F3\u9891";
      insertNodeAtCursor(span);
      handleChange();
    };
    const insertAt = (name, id) => {
      if (!editorRef.current || !name.trim()) return;
      const atBox = document.createElement("span");
      atBox.dataset.type = "at";
      atBox.dataset.name = name;
      if (id) atBox.dataset.id = id;
      atBox.className = "editor-at";
      atBox.contentEditable = "false";
      const atSymbol = document.createElement("span");
      atSymbol.textContent = "@";
      atSymbol.className = "editor-at-symbol";
      const nameText = document.createElement("span");
      nameText.textContent = name;
      nameText.className = "editor-at-name";
      atBox.appendChild(atSymbol);
      atBox.appendChild(nameText);
      insertNodeAtCursor(atBox);
      handleChange();
    };
    const insertNodeAtCursor = (node) => {
      if (!editorRef.current) return;
      editorRef.current.focus();
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const isInsideEditor = editorRef.current.contains(range.commonAncestorContainer);
        if (isInsideEditor) {
          range.deleteContents();
          range.insertNode(node);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        } else {
          editorRef.current.appendChild(node);
          const newRange = document.createRange();
          newRange.setStartAfter(node);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
      } else {
        editorRef.current.appendChild(node);
        const selection2 = window.getSelection();
        if (selection2) {
          const newRange = document.createRange();
          newRange.setStartAfter(node);
          newRange.collapse(true);
          selection2.removeAllRanges();
          selection2.addRange(newRange);
        }
      }
    };
    const clear = () => {
      if (editorRef.current) {
        editorRef.current.innerHTML = "";
        handleChange();
      }
    };
    const focus = () => {
      editorRef.current?.focus();
    };
    const getContent = () => {
      return parseEditorContent();
    };
    const checkAtTrigger = () => {
      if (!editorRef.current || !onAtTrigger) return;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        onAtTrigger(false, "");
        atTriggerTextRef.current = null;
        return;
      }
      const range = selection.getRangeAt(0);
      if (!editorRef.current.contains(range.commonAncestorContainer)) {
        onAtTrigger(false, "");
        atTriggerTextRef.current = null;
        return;
      }
      const node = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE) {
        onAtTrigger(false, "");
        atTriggerTextRef.current = null;
        return;
      }
      const textNode = node;
      const textBeforeCursor = textNode.textContent?.substring(0, range.startOffset) || "";
      const atIndex = textBeforeCursor.lastIndexOf("@");
      if (atIndex !== -1) {
        const textAfterAt = textBeforeCursor.substring(atIndex + 1);
        if (textAfterAt.includes(" ") || textAfterAt.includes("\n")) {
          onAtTrigger(false, "");
          atTriggerTextRef.current = null;
          return;
        }
        atTriggerTextRef.current = textNode;
        const tempRange = document.createRange();
        tempRange.setStart(textNode, atIndex);
        tempRange.setEnd(textNode, atIndex + 1);
        const rect = tempRange.getBoundingClientRect();
        const editorRect = editorRef.current.getBoundingClientRect();
        onAtTrigger(true, textAfterAt, {
          top: rect.bottom - editorRect.top,
          left: rect.left - editorRect.left
        });
      } else {
        onAtTrigger(false, "");
        atTriggerTextRef.current = null;
      }
    };
    const handleChange = () => {
      checkAtTrigger();
      if (onChange) {
        const { text, segments } = parseEditorContent();
        onChange(text, segments);
      }
    };
    const replaceAtTrigger = (name, id) => {
      if (!atTriggerTextRef.current) return;
      const textNode = atTriggerTextRef.current;
      const text = textNode.textContent || "";
      const atIndex = text.lastIndexOf("@");
      if (atIndex !== -1) {
        const textAfter = text.substring(atIndex + 1);
        const endIndex = atIndex + 1 + textAfter.split(/[\s\n]/)[0].length;
        const beforeAt = text.substring(0, atIndex);
        const afterSearch = text.substring(endIndex);
        textNode.textContent = beforeAt + afterSearch;
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.setStart(textNode, atIndex);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
      atTriggerTextRef.current = null;
      insertAt(name, id);
    };
    const handlePaste = (e) => {
      e.preventDefault();
      const clipboardData = e.clipboardData;
      const items = Array.from(clipboardData.items);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      if (imageItem) {
        const file = imageItem.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") {
              insertImage(reader.result);
            }
          };
          reader.readAsDataURL(file);
        }
        return;
      }
      const text = clipboardData.getData("text/plain");
      if (text) {
        document.execCommand("insertText", false, text);
        handleChange();
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (onSend) {
          const { text, segments } = parseEditorContent();
          onSend(text, segments);
        }
      }
    };
    useImperativeHandle(ref, () => ({
      focus,
      clear,
      insertFace,
      insertImage,
      insertVideo,
      insertAudio,
      insertAt,
      replaceAtTrigger,
      getContent
    }));
    return /* @__PURE__ */ jsx(
      "div",
      {
        ref: editorRef,
        contentEditable: true,
        suppressContentEditableWarning: true,
        onInput: handleChange,
        onKeyDown: handleKeyDown,
        onPaste: handlePaste,
        "data-placeholder": placeholder,
        className: "rich-text-editor",
        style: {
          width: "100%",
          minHeight,
          maxHeight,
          padding: "0.5rem 0.75rem",
          border: "1px solid var(--gray-6)",
          borderRadius: "6px",
          backgroundColor: "var(--gray-1)",
          fontSize: "var(--font-size-2)",
          outline: "none",
          overflowY: "auto",
          lineHeight: "1.5",
          wordWrap: "break-word",
          color: "var(--gray-12)"
        }
      }
    );
  }
);
RichTextEditor.displayName = "RichTextEditor";
var RichTextEditor_default = RichTextEditor;

// pages/SandboxChat.tsx
import { Fragment, jsx as jsx2, jsxs } from "/esm/react~jsx-runtime.mjs?v=ms2oc1s3";
function Sandbox() {
  const [messages, setMessages] = useState3([]);
  const [channels, setChannels] = useState3([
    { id: "user_1001", name: "\u6D4B\u8BD5\u7528\u6237", type: "private", unread: 0 },
    { id: "group_2001", name: "\u6D4B\u8BD5\u7FA4\u7EC4", type: "group", unread: 0 },
    { id: "channel_3001", name: "\u6D4B\u8BD5\u9891\u9053", type: "channel", unread: 0 }
  ]);
  const [faceList, setFaceList] = useState3([]);
  const [activeChannel, setActiveChannel] = useState3(channels[0]);
  const [inputText, setInputText] = useState3("");
  const [endpointName, setBotName] = useState3("ProcessEndpoint");
  const [connected, setConnected] = useState3(false);
  const [showFacePicker, setShowFacePicker] = useState3(false);
  const [mediaPanel, setMediaPanel] = useState3(null);
  const [mediaUrl, setMediaUrl] = useState3("");
  const [showAtPicker, setShowAtPicker] = useState3(false);
  const [atPopoverPosition, setAtPopoverPosition] = useState3(null);
  const [atSearchQuery, setAtSearchQuery] = useState3("");
  const [faceSearchQuery, setFaceSearchQuery] = useState3("");
  const [atUserName, setAtUserName] = useState3("");
  const [atSuggestions] = useState3([
    { id: "10001", name: "\u5F20\u4E09" },
    { id: "10002", name: "\u674E\u56DB" },
    { id: "10003", name: "\u738B\u4E94" },
    { id: "10004", name: "\u8D75\u516D" },
    { id: "10005", name: "\u6D4B\u8BD5\u7528\u6237" },
    { id: "10086", name: "Admin" },
    { id: "10010", name: "Test User" }
  ]);
  const [previewSegments, setPreviewSegments] = useState3([]);
  const [showChannelList, setShowChannelList] = useState3(false);
  const [viewMode, setViewMode] = useState3("chat");
  const messagesEndRef = useRef3(null);
  const wsRef = useRef3(null);
  const editorRef = useRef3(null);
  const fetchFaceList = async () => {
    try {
      const res = await fetch("https://face.viki.moe/metadata.json");
      setFaceList(await res.json());
    } catch (err) {
      console.error("[Sandbox] Failed to fetch face list:", err);
    }
  };
  useEffect3(() => {
    fetchFaceList();
  }, []);
  const handleInboundPayload = (data) => {
    if (data.type === "edit" && data.messageId) {
      const content2 = Array.isArray(data.content) ? data.content : parseTextToSegments(String(data.content ?? ""));
      setMessages((prev) => prev.map((m) => m.id === data.messageId ? { ...m, content: content2 } : m));
      return;
    }
    const content = typeof data.content === "string" ? parseTextToSegments(data.content) : Array.isArray(data.content) ? data.content : parseTextToSegments(String(data.content ?? ""));
    const channelName = data.type === "private" ? `\u79C1\u804A-${data.bot || endpointName}` : data.type === "group" ? `\u7FA4\u7EC4-${data.id}` : `\u9891\u9053-${data.id}`;
    const channelType = data.type;
    setChannels((prev) => {
      if (prev.some((c) => c.id === data.id)) return prev;
      const created = { id: data.id, name: channelName, type: channelType, unread: 0 };
      setActiveChannel(created);
      return [...prev, created];
    });
    setMessages((prev) => [...prev, {
      id: data.messageId ?? `bot_${data.timestamp}`,
      type: "received",
      channelType,
      channelId: data.id,
      channelName,
      senderId: "endpoint",
      senderName: data.bot || endpointName,
      content,
      timestamp: data.timestamp
    }]);
  };
  const sendInteractiveAction = (payload) => {
    const segments = [{ type: "action", data: { id: payload, payload } }];
    const payloadJson = JSON.stringify({ type: activeChannel.type, id: activeChannel.id, content: segments, timestamp: Date.now() });
    wsRef.current?.send(payloadJson);
  };
  useEffect3(() => {
    let closed = false;
    let retryTimer;
    let attempt = 0;
    let replaceInFlight = false;
    const connect = () => {
      if (closed) return;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = void 0;
      }
      const wsUrl = buildSandboxWebSocketUrl();
      const previous = wsRef.current;
      if (previous) {
        replaceInFlight = true;
        previous.onclose = null;
        previous.onerror = null;
        previous.onmessage = null;
        previous.onopen = null;
        try {
          previous.close();
        } catch {
        }
        replaceInFlight = false;
      }
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
      };
      ws.onmessage = (event) => {
        try {
          handleInboundPayload(JSON.parse(String(event.data)));
        } catch (err) {
          console.error("[Sandbox] Failed to parse message:", err);
        }
      };
      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        setConnected(false);
        wsRef.current = null;
        if (closed || replaceInFlight) return;
        const delay = Math.min(8e3, 500 * 2 ** attempt);
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => {
      };
    };
    const onAuthOrStorage = (event) => {
      if (event && event.type === "storage") {
        const key = event.key;
        if (key != null && key !== "zhin_api_token" && key !== "zhin_api_base" && key !== "HTTP_TOKEN" && key !== "zhin_http_token") {
          return;
        }
      }
      attempt = 0;
      connect();
    };
    connect();
    if (typeof window !== "undefined") {
      window.addEventListener("storage", onAuthOrStorage);
      window.addEventListener("zhin:auth-required", onAuthOrStorage);
      window.addEventListener("zhin:auth-changed", onAuthOrStorage);
      window.addEventListener("zhin:api-base-changed", onAuthOrStorage);
    }
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (typeof window !== "undefined") {
        window.removeEventListener("storage", onAuthOrStorage);
        window.removeEventListener("zhin:auth-required", onAuthOrStorage);
        window.removeEventListener("zhin:auth-changed", onAuthOrStorage);
        window.removeEventListener("zhin:api-base-changed", onAuthOrStorage);
      }
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, []);
  useEffect3(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  useEffect3(() => {
    setPreviewSegments(inputText.trim() ? parseTextToSegments(inputText) : []);
  }, [inputText]);
  const parseTextToSegments = (text) => {
    const segments = [];
    const regex = /\[@([^\]]+)\]|\[face:(\d+)\]|\[image:([^\]]+)\]|\[video:([^\]]+)\]|\[audio:([^\]]+)\]/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        const t = text.substring(lastIndex, match.index);
        if (t) segments.push({ type: "text", data: { text: t } });
      }
      if (match[1]) segments.push({ type: "mention", data: { target: match[1], name: match[1] } });
      else if (match[2]) segments.push({ type: "face", data: { id: parseInt(match[2], 10) } });
      else if (match[3]) segments.push({ type: "image", data: { url: match[3] } });
      else if (match[4]) segments.push({ type: "video", data: { url: match[4] } });
      else if (match[5]) segments.push({ type: "audio", data: { url: match[5] } });
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
      const r2 = text.substring(lastIndex);
      if (r2) segments.push({ type: "text", data: { text: r2 } });
    }
    return segments.length > 0 ? segments : [{ type: "text", data: { text } }];
  };
  const hasRenderableSegments = (segments) => {
    if (segments.length === 0) return false;
    return segments.some((s) => {
      if (s.type === "text") return Boolean(String(s.data?.text ?? "").trim());
      if (s.type === "keyboard") return true;
      return true;
    });
  };
  const renderMessageSegments = (segments, isSent) => {
    const ring = isSent ? "ring-1 ring-primary-foreground/25" : "ring-1 ring-border/60";
    return segments.map((segment, index) => {
      if (typeof segment === "string") {
        return /* @__PURE__ */ jsx2("span", { children: segment.split("\n").map((part, i) => /* @__PURE__ */ jsxs(React2.Fragment, { children: [
          part,
          i < segment.split("\n").length - 1 && /* @__PURE__ */ jsx2("br", {})
        ] }, i)) }, index);
      }
      const d = segment.data;
      switch (segment.type) {
        case "text":
          return /* @__PURE__ */ jsx2("span", { children: String(d.text ?? "").split("\n").map((part, i) => /* @__PURE__ */ jsxs(React2.Fragment, { children: [
            part,
            i < String(d.text ?? "").split("\n").length - 1 && /* @__PURE__ */ jsx2("br", {})
          ] }, i)) }, index);
        case "mention":
        case "at":
          return /* @__PURE__ */ jsxs("span", { className: "inline-flex items-center px-1.5 py-0.5 rounded bg-accent text-accent-foreground text-xs mx-0.5", children: [
            "@",
            String(d.name ?? d.target ?? d.qq ?? "")
          ] }, index);
        case "face":
          return /* @__PURE__ */ jsx2("img", { src: `https://face.viki.moe/apng/${d.id}.png`, alt: String(d.name ?? ""), className: "w-6 h-6 inline-block align-middle mx-0.5", title: String(d.name ?? d.id ?? "") }, index);
        case "dice":
          return /* @__PURE__ */ jsxs("span", { className: "inline-flex items-center px-1.5 py-0.5 rounded bg-secondary text-xs mx-0.5", children: [
            "\u{1F3B2} ",
            d.result != null ? `\u70B9\u6570 ${String(d.result)}` : "\u9AB0\u5B50"
          ] }, index);
        case "rps":
          return /* @__PURE__ */ jsxs("span", { className: "inline-flex items-center px-1.5 py-0.5 rounded bg-secondary text-xs mx-0.5", children: [
            "\u270A ",
            d.result != null ? `\u7ED3\u679C ${String(d.result)}` : "\u731C\u62F3"
          ] }, index);
        case "image": {
          const raw = pickMediaRawUrl(d);
          const src = resolveMediaSrc(raw, "image");
          if (!src) return /* @__PURE__ */ jsx2("span", { className: "text-xs opacity-70", children: "[\u56FE\u7247]" }, index);
          return /* @__PURE__ */ jsx2("a", { href: src, target: "_blank", rel: "noreferrer", className: "block my-1", children: /* @__PURE__ */ jsx2("img", { src, alt: "", className: cn("max-w-[min(320px,88vw)] rounded-lg block", ring, "ring-offset-0"), onError: (e) => {
            e.target.style.display = "none";
          } }) }, index);
        }
        case "video": {
          const raw = pickMediaRawUrl(d);
          const src = resolveMediaSrc(raw, "video");
          if (!src) return /* @__PURE__ */ jsx2("span", { className: "text-xs opacity-70", children: "[\u89C6\u9891\u65E0\u5730\u5740]" }, index);
          return /* @__PURE__ */ jsx2(
            "video",
            {
              src,
              controls: true,
              playsInline: true,
              preload: "metadata",
              className: cn("max-w-[min(360px,92vw)] max-h-72 rounded-lg my-1 bg-black/10", ring)
            },
            index
          );
        }
        case "audio":
        case "record": {
          const raw = pickMediaRawUrl(d);
          const src = resolveMediaSrc(raw, "audio");
          if (!src) return /* @__PURE__ */ jsx2("span", { className: "text-xs opacity-70", children: "[\u97F3\u9891\u65E0\u5730\u5740]" }, index);
          return /* @__PURE__ */ jsx2(
            "audio",
            {
              src,
              controls: true,
              preload: "metadata",
              className: cn("w-full max-w-sm my-2 h-10", isSent && "opacity-95")
            },
            index
          );
        }
        case "reply":
          return /* @__PURE__ */ jsxs("div", { className: "mb-1 rounded-md border border-dashed px-2 py-1 text-xs opacity-90", children: [
            "\u21A9 \u5F15\u7528\u6D88\u606F #",
            String(d.message_id ?? d.id ?? "")
          ] }, index);
        case "forward": {
          const messages2 = d.messages;
          const title = String(d.title ?? "\u804A\u5929\u8BB0\u5F55");
          return /* @__PURE__ */ jsxs("div", { className: "my-1 rounded-md border bg-background/40 px-2 py-2 text-xs space-y-1", children: [
            /* @__PURE__ */ jsxs("div", { className: "font-medium", children: [
              "\u{1F4E8} ",
              title
            ] }),
            Array.isArray(messages2) && messages2.length > 0 ? /* @__PURE__ */ jsxs("div", { className: "space-y-1 pl-2 border-l-2 border-muted", children: [
              messages2.slice(0, 3).map((batch, bi) => /* @__PURE__ */ jsx2("div", { className: "opacity-90", children: batch.map((s, si) => /* @__PURE__ */ jsx2("span", { children: s.type === "text" ? String(s.data?.text ?? "") : `[${s.type ?? "seg"}]` }, si)) }, bi)),
              messages2.length > 3 && /* @__PURE__ */ jsxs("div", { className: "opacity-60", children: [
                "\u2026\u5171 ",
                messages2.length,
                " \u6761"
              ] })
            ] }) : /* @__PURE__ */ jsx2("div", { className: "opacity-70", children: "[\u5408\u5E76\u8F6C\u53D1]" })
          ] }, index);
        }
        case "keyboard": {
          const rows = d.rows ?? [];
          return /* @__PURE__ */ jsx2("div", { className: "inline-grid gap-1 my-1", children: rows.map((row, ri) => /* @__PURE__ */ jsx2("div", { className: "flex gap-1", children: row.map((btn) => /* @__PURE__ */ jsx2(
            "button",
            {
              type: "button",
              disabled: btn.disabled || isSent,
              onClick: () => sendInteractiveAction(btn.payload),
              className: cn(
                "min-w-9 h-9 rounded-md border text-sm font-medium transition-colors",
                btn.disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-accent active:scale-95"
              ),
              children: btn.label
            },
            btn.payload
          )) }, ri)) }, index);
        }
        default:
          return /* @__PURE__ */ jsxs("span", { className: "text-xs opacity-70", children: [
            "[",
            segment.type,
            "]"
          ] }, index);
      }
    });
  };
  const handleSendMessage = (text, segments) => {
    if (!hasRenderableSegments(segments)) return;
    const newMessage = { id: `msg_${Date.now()}`, type: "sent", channelType: activeChannel.type, channelId: activeChannel.id, channelName: activeChannel.name, senderId: "test_user", senderName: "\u6D4B\u8BD5\u7528\u6237", content: segments, timestamp: Date.now() };
    setMessages((prev) => [...prev, newMessage]);
    setInputText("");
    setPreviewSegments([]);
    editorRef.current?.clear();
    const payload = JSON.stringify({ type: activeChannel.type, id: activeChannel.id, content: segments, timestamp: Date.now() });
    wsRef.current?.send(payload);
  };
  const clearMessages = () => {
    if (confirm("\u786E\u5B9A\u6E05\u7A7A\u6240\u6709\u6D88\u606F\u8BB0\u5F55\uFF1F")) setMessages([]);
  };
  const switchChannel = (channel) => {
    setViewMode("chat");
    setActiveChannel(channel);
    setChannels((prev) => prev.map((c) => c.id === channel.id ? { ...c, unread: 0 } : c));
    if (window.innerWidth < 768) setShowChannelList(false);
  };
  const addChannel = () => {
    const types = ["private", "group", "channel"];
    const type = types[Math.floor(Math.random() * types.length)];
    const name = prompt(`\u8BF7\u8F93\u5165\u9891\u9053\u540D\u79F0\uFF1A`);
    if (name) {
      const nc = { id: `${type}_${Date.now()}`, name, type, unread: 0 };
      setChannels((p) => [...p, nc]);
      setActiveChannel(nc);
    }
  };
  const getChannelIcon = (type) => {
    switch (type) {
      case "private":
        return /* @__PURE__ */ jsx2(User, { size: 16 });
      case "group":
        return /* @__PURE__ */ jsx2(Users, { size: 16 });
      case "channel":
        return /* @__PURE__ */ jsx2(Hash, { size: 16 });
      default:
        return /* @__PURE__ */ jsx2(MessageSquare, { size: 16 });
    }
  };
  const insertFace = (faceId) => {
    editorRef.current?.insertFace(faceId);
    setShowFacePicker(false);
  };
  const commitMediaUrl = () => {
    const u = mediaUrl.trim();
    if (!u || !mediaPanel) return;
    if (mediaPanel === "image") editorRef.current?.insertImage(u);
    else if (mediaPanel === "video") editorRef.current?.insertVideo(u);
    else editorRef.current?.insertAudio(u);
    setMediaUrl("");
    setMediaPanel(null);
  };
  const insertAtUser = () => {
    if (!atUserName.trim()) return;
    editorRef.current?.insertAt(atUserName.trim());
    setAtUserName("");
    setShowAtPicker(false);
  };
  const selectAtUser = (user) => {
    editorRef.current?.replaceAtTrigger(user.name, user.id);
    setAtPopoverPosition(null);
    setAtSearchQuery("");
  };
  const handleAtTrigger = (show, searchQuery, position) => {
    if (activeChannel.type === "private") {
      setAtPopoverPosition(null);
      setAtSearchQuery("");
      return;
    }
    if (show && position) {
      setAtPopoverPosition(position);
      setAtSearchQuery(searchQuery);
    } else {
      setAtPopoverPosition(null);
      setAtSearchQuery("");
    }
  };
  const filteredAtSuggestions = atSuggestions.filter((user) => {
    if (!atSearchQuery.trim()) return true;
    const q = atSearchQuery.toLowerCase();
    return user.name.toLowerCase().includes(q) || user.id.toLowerCase().includes(q);
  });
  const handleEditorChange = (text, segments) => {
    setInputText(text);
    setPreviewSegments(segments);
  };
  const filteredFaces = faceList.filter((face) => face.name.toLowerCase().includes(faceSearchQuery.toLowerCase()) || face.describe.toLowerCase().includes(faceSearchQuery.toLowerCase()));
  const channelMessages = messages.filter((msg) => msg.channelId === activeChannel.id);
  return /* @__PURE__ */ jsxs("div", { className: "sandbox-container rounded-xl border border-border/70 bg-card/30 shadow-sm", children: [
    /* @__PURE__ */ jsxs("button", { className: "mobile-channel-toggle md:hidden", onClick: () => setShowChannelList(!showChannelList), children: [
      /* @__PURE__ */ jsx2(MessageSquare, { size: 20 }),
      " \u9891\u9053\u5217\u8868"
    ] }),
    /* @__PURE__ */ jsxs("div", { className: cn("channel-sidebar rounded-lg border bg-card", showChannelList && "show"), children: [
      /* @__PURE__ */ jsx2("div", { className: "p-3 border-b", children: /* @__PURE__ */ jsxs("div", { className: "flex justify-between items-center", children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsx2("div", { className: "p-1 rounded-md bg-secondary", children: /* @__PURE__ */ jsx2(MessageSquare, { size: 16, className: "text-muted-foreground" }) }),
          /* @__PURE__ */ jsx2("h3", { className: "font-semibold", children: "\u9891\u9053\u5217\u8868" })
        ] }),
        /* @__PURE__ */ jsxs("span", { className: cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border", connected ? "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800" : "bg-muted text-muted-foreground"), children: [
          connected ? /* @__PURE__ */ jsx2(Wifi, { size: 12 }) : /* @__PURE__ */ jsx2(WifiOff, { size: 12 }),
          connected ? "\u5DF2\u8FDE\u63A5" : "\u672A\u8FDE\u63A5"
        ] })
      ] }) }),
      /* @__PURE__ */ jsxs("div", { className: "flex-1 overflow-y-auto p-2 space-y-1", children: [
        channels.map((channel) => {
          const isActive = viewMode === "chat" && activeChannel.id === channel.id;
          return /* @__PURE__ */ jsxs("div", { className: cn("menu-item", isActive && "active"), onClick: () => switchChannel(channel), children: [
            /* @__PURE__ */ jsx2("span", { className: "shrink-0", children: getChannelIcon(channel.type) }),
            /* @__PURE__ */ jsxs("div", { className: "flex-1 min-w-0", children: [
              /* @__PURE__ */ jsx2("div", { className: "text-sm font-medium truncate", children: channel.name }),
              /* @__PURE__ */ jsx2("div", { className: "text-xs text-muted-foreground", children: channel.type === "private" ? "\u79C1\u804A" : channel.type === "group" ? "\u7FA4\u804A" : "\u9891\u9053" })
            ] }),
            channel.unread > 0 && /* @__PURE__ */ jsx2("span", { className: "inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium px-1", children: channel.unread })
          ] }, channel.id);
        }),
        /* @__PURE__ */ jsxs("div", { className: "pt-2 mt-2 border-t space-y-1", children: [
          /* @__PURE__ */ jsxs("div", { className: cn("menu-item", viewMode === "requests" && "active"), onClick: () => {
            setViewMode("requests");
            if (window.innerWidth < 768) setShowChannelList(false);
          }, children: [
            /* @__PURE__ */ jsx2(UserPlus, { size: 16, className: "shrink-0" }),
            /* @__PURE__ */ jsxs("div", { className: "flex-1 min-w-0", children: [
              /* @__PURE__ */ jsx2("div", { className: "text-sm font-medium", children: "\u8BF7\u6C42" }),
              /* @__PURE__ */ jsx2("div", { className: "text-xs text-muted-foreground", children: "\u597D\u53CB/\u7FA4\u9080\u8BF7\u7B49" })
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: cn("menu-item", viewMode === "notices" && "active"), onClick: () => {
            setViewMode("notices");
            if (window.innerWidth < 768) setShowChannelList(false);
          }, children: [
            /* @__PURE__ */ jsx2(Bell, { size: 16, className: "shrink-0" }),
            /* @__PURE__ */ jsxs("div", { className: "flex-1 min-w-0", children: [
              /* @__PURE__ */ jsx2("div", { className: "text-sm font-medium", children: "\u901A\u77E5" }),
              /* @__PURE__ */ jsx2("div", { className: "text-xs text-muted-foreground", children: "\u7FA4\u7BA1/\u64A4\u56DE\u7B49" })
            ] })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsx2("div", { className: "p-2 border-t", children: /* @__PURE__ */ jsx2("button", { className: "w-full py-2 px-3 rounded-md border border-dashed text-sm text-muted-foreground hover:bg-accent transition-colors", onClick: addChannel, children: "+ \u6DFB\u52A0\u9891\u9053" }) })
    ] }),
    showChannelList && /* @__PURE__ */ jsx2("div", { className: "channel-overlay md:hidden", onClick: () => setShowChannelList(false) }),
    /* @__PURE__ */ jsxs("div", { className: "chat-area", children: [
      viewMode === "requests" && /* @__PURE__ */ jsxs("div", { className: "rounded-lg border bg-card flex-1 flex flex-col min-h-0 overflow-hidden", children: [
        /* @__PURE__ */ jsx2("div", { className: "p-3 border-b flex-shrink-0", children: /* @__PURE__ */ jsxs("h2", { className: "text-lg font-bold flex items-center gap-2", children: [
          /* @__PURE__ */ jsx2(UserPlus, { size: 20 }),
          " \u8BF7\u6C42"
        ] }) }),
        /* @__PURE__ */ jsxs("div", { className: "flex-1 overflow-y-auto p-4 flex flex-col items-center justify-center gap-3 text-muted-foreground text-center", children: [
          /* @__PURE__ */ jsx2(UserPlus, { size: 48, className: "opacity-30" }),
          /* @__PURE__ */ jsx2("span", { children: "\u6C99\u76D2\u4E3A\u6A21\u62DF\u73AF\u5883\uFF0C\u6682\u65E0\u8BF7\u6C42\u6570\u636E" }),
          /* @__PURE__ */ jsxs("span", { className: "text-sm", children: [
            "\u5B9E\u9645\u597D\u53CB/\u7FA4\u9080\u8BF7\u7B49\u8BF7\u6C42\u8BF7\u5230\u4FA7\u8FB9\u680F ",
            /* @__PURE__ */ jsx2("strong", { children: "\u673A\u5668\u4EBA" }),
            " \u9875\u9762\u8FDB\u5165\u5BF9\u5E94\u673A\u5668\u4EBA\u7BA1\u7406\u67E5\u770B"
          ] })
        ] })
      ] }),
      viewMode === "notices" && /* @__PURE__ */ jsxs("div", { className: "rounded-lg border bg-card flex-1 flex flex-col min-h-0 overflow-hidden", children: [
        /* @__PURE__ */ jsx2("div", { className: "p-3 border-b flex-shrink-0", children: /* @__PURE__ */ jsxs("h2", { className: "text-lg font-bold flex items-center gap-2", children: [
          /* @__PURE__ */ jsx2(Bell, { size: 20 }),
          " \u901A\u77E5"
        ] }) }),
        /* @__PURE__ */ jsxs("div", { className: "flex-1 overflow-y-auto p-4 flex flex-col items-center justify-center gap-3 text-muted-foreground text-center", children: [
          /* @__PURE__ */ jsx2(Bell, { size: 48, className: "opacity-30" }),
          /* @__PURE__ */ jsx2("span", { children: "\u6C99\u76D2\u4E3A\u6A21\u62DF\u73AF\u5883\uFF0C\u6682\u65E0\u901A\u77E5\u6570\u636E" }),
          /* @__PURE__ */ jsxs("span", { className: "text-sm", children: [
            "\u5B9E\u9645\u7FA4\u7BA1\u3001\u64A4\u56DE\u7B49\u901A\u77E5\u8BF7\u5230\u4FA7\u8FB9\u680F ",
            /* @__PURE__ */ jsx2("strong", { children: "\u673A\u5668\u4EBA" }),
            " \u9875\u9762\u8FDB\u5165\u5BF9\u5E94\u673A\u5668\u4EBA\u7BA1\u7406\u67E5\u770B"
          ] })
        ] })
      ] }),
      viewMode === "chat" && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx2("div", { className: "rounded-lg border bg-card p-3 flex-shrink-0", children: /* @__PURE__ */ jsxs("div", { className: "flex justify-between items-center flex-wrap gap-2", children: [
          /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3", children: [
            /* @__PURE__ */ jsx2("div", { className: "p-2 rounded-lg bg-secondary", children: getChannelIcon(activeChannel.type) }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx2("h2", { className: "text-lg font-bold", children: activeChannel.name }),
              /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [
                /* @__PURE__ */ jsx2("span", { children: activeChannel.id }),
                /* @__PURE__ */ jsx2("span", { className: "inline-flex items-center px-1.5 py-0.5 rounded border text-[10px]", children: channelMessages.length }),
                /* @__PURE__ */ jsx2("span", { children: "\u6761\u6D88\u606F" })
              ] })
            ] }),
            /* @__PURE__ */ jsx2("span", { className: "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground", children: activeChannel.type === "private" ? "\u79C1\u804A" : activeChannel.type === "group" ? "\u7FA4\u804A" : "\u9891\u9053" })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ jsx2(
              "input",
              {
                value: endpointName,
                onChange: (e) => setBotName(e.target.value),
                placeholder: "\u673A\u5668\u4EBA\u540D\u79F0",
                className: "h-8 w-28 rounded-md border bg-transparent px-2 text-sm"
              }
            ),
            /* @__PURE__ */ jsxs("button", { className: "inline-flex items-center gap-1 h-8 px-3 rounded-md bg-secondary text-secondary-foreground text-sm hover:bg-secondary/80", onClick: clearMessages, children: [
              /* @__PURE__ */ jsx2(Trash2, { size: 14 }),
              " \u6E05\u7A7A"
            ] })
          ] })
        ] }) }),
        /* @__PURE__ */ jsx2("div", { className: "rounded-lg border bg-card flex-1 flex flex-col min-h-0", children: /* @__PURE__ */ jsx2("div", { className: "flex-1 overflow-y-auto p-4", children: channelMessages.length === 0 ? /* @__PURE__ */ jsxs("div", { className: "flex flex-col items-center justify-center h-full gap-3", children: [
          /* @__PURE__ */ jsx2(MessageSquare, { size: 64, className: "text-muted-foreground/20" }),
          /* @__PURE__ */ jsx2("span", { className: "text-muted-foreground", children: "\u6682\u65E0\u6D88\u606F\uFF0C\u5F00\u59CB\u5BF9\u8BDD\u5427\uFF01" })
        ] }) : /* @__PURE__ */ jsxs("div", { className: "space-y-2", children: [
          channelMessages.map((msg) => /* @__PURE__ */ jsx2("div", { className: cn("flex", msg.type === "sent" ? "justify-end" : "justify-start"), children: /* @__PURE__ */ jsxs("div", { className: cn("max-w-[70%] p-3 rounded-2xl", msg.type === "sent" ? "bg-primary text-primary-foreground" : "bg-muted"), children: [
            /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 mb-1", children: [
              msg.type === "received" && /* @__PURE__ */ jsx2(Bot, { size: 14 }),
              msg.type === "sent" && /* @__PURE__ */ jsx2(User, { size: 14 }),
              /* @__PURE__ */ jsx2("span", { className: "text-xs font-medium opacity-90", children: msg.senderName }),
              /* @__PURE__ */ jsx2("span", { className: "text-xs opacity-70", children: new Date(msg.timestamp).toLocaleTimeString() })
            ] }),
            /* @__PURE__ */ jsx2("div", { className: "text-sm space-y-1", children: renderMessageSegments(msg.content, msg.type === "sent") })
          ] }) }, msg.id)),
          /* @__PURE__ */ jsx2("div", { ref: messagesEndRef })
        ] }) }) }),
        /* @__PURE__ */ jsxs("div", { className: "rounded-lg border bg-card p-3 flex-shrink-0 space-y-3", children: [
          /* @__PURE__ */ jsxs("div", { className: "flex gap-2 items-center flex-wrap", children: [
            /* @__PURE__ */ jsx2(
              "button",
              {
                type: "button",
                className: cn("h-8 w-8 rounded-md flex items-center justify-center border transition-colors", showFacePicker ? "bg-primary text-primary-foreground" : "hover:bg-accent"),
                onClick: () => {
                  setShowFacePicker(!showFacePicker);
                  setMediaPanel(null);
                },
                title: "\u63D2\u5165\u8868\u60C5",
                children: /* @__PURE__ */ jsx2(Smile, { size: 16 })
              }
            ),
            /* @__PURE__ */ jsx2(
              "button",
              {
                type: "button",
                className: cn("h-8 w-8 rounded-md flex items-center justify-center border transition-colors", mediaPanel === "image" ? "bg-primary text-primary-foreground" : "hover:bg-accent"),
                onClick: () => {
                  setMediaPanel((p) => p === "image" ? null : "image");
                  setShowFacePicker(false);
                },
                title: "\u63D2\u5165\u56FE\u7247 URL",
                children: /* @__PURE__ */ jsx2(Image, { size: 16 })
              }
            ),
            /* @__PURE__ */ jsx2(
              "button",
              {
                type: "button",
                className: cn("h-8 w-8 rounded-md flex items-center justify-center border transition-colors", mediaPanel === "video" ? "bg-primary text-primary-foreground" : "hover:bg-accent"),
                onClick: () => {
                  setMediaPanel((p) => p === "video" ? null : "video");
                  setShowFacePicker(false);
                },
                title: "\u63D2\u5165\u89C6\u9891 URL",
                children: /* @__PURE__ */ jsx2(Video, { size: 16 })
              }
            ),
            /* @__PURE__ */ jsx2(
              "button",
              {
                type: "button",
                className: cn("h-8 w-8 rounded-md flex items-center justify-center border transition-colors", mediaPanel === "audio" ? "bg-primary text-primary-foreground" : "hover:bg-accent"),
                onClick: () => {
                  setMediaPanel((p) => p === "audio" ? null : "audio");
                  setShowFacePicker(false);
                },
                title: "\u63D2\u5165\u97F3\u9891 URL",
                children: /* @__PURE__ */ jsx2(Music, { size: 16 })
              }
            ),
            /* @__PURE__ */ jsx2("div", { className: "flex-1 min-w-[1rem]" }),
            inputText && /* @__PURE__ */ jsx2(
              "button",
              {
                className: "h-8 w-8 rounded-md flex items-center justify-center hover:bg-accent transition-colors",
                onClick: () => {
                  setInputText("");
                  setPreviewSegments([]);
                },
                children: /* @__PURE__ */ jsx2(X, { size: 16 })
              }
            )
          ] }),
          showFacePicker && /* @__PURE__ */ jsxs("div", { className: "p-3 rounded-md border bg-muted/30 max-h-64 overflow-y-auto space-y-2", children: [
            /* @__PURE__ */ jsx2(
              "input",
              {
                value: faceSearchQuery,
                onChange: (e) => setFaceSearchQuery(e.target.value),
                placeholder: "\u641C\u7D22\u8868\u60C5...",
                className: "w-full h-8 rounded-md border bg-transparent px-2 text-sm"
              }
            ),
            /* @__PURE__ */ jsx2("div", { className: "grid grid-cols-8 gap-1", children: filteredFaces.slice(0, 80).map((face) => /* @__PURE__ */ jsx2(
              "button",
              {
                onClick: () => insertFace(face.id),
                title: face.name,
                className: "w-10 h-10 rounded-md border flex items-center justify-center hover:bg-accent transition-colors",
                children: /* @__PURE__ */ jsx2("img", { src: `https://face.viki.moe/apng/${face.id}.png`, alt: face.name, className: "w-8 h-8" })
              },
              face.id
            )) }),
            filteredFaces.length === 0 && /* @__PURE__ */ jsxs("div", { className: "flex flex-col items-center gap-2 py-4", children: [
              /* @__PURE__ */ jsx2(Search, { size: 32, className: "text-muted-foreground/30" }),
              /* @__PURE__ */ jsx2("span", { className: "text-sm text-muted-foreground", children: "\u672A\u627E\u5230\u5339\u914D\u7684\u8868\u60C5" })
            ] })
          ] }),
          mediaPanel && /* @__PURE__ */ jsxs("div", { className: "p-3 rounded-md border bg-muted/30 space-y-2", children: [
            /* @__PURE__ */ jsxs("p", { className: "text-xs text-muted-foreground", children: [
              mediaPanel === "image" && "\u652F\u6301 http(s) \u56FE\u7247\u94FE\u63A5\u6216 data URL",
              mediaPanel === "video" && "\u652F\u6301\u6D4F\u89C8\u5668\u53EF\u89E3\u7801\u7684\u89C6\u9891\u76F4\u94FE\uFF08\u5982 .mp4\u3001.webm\uFF09",
              mediaPanel === "audio" && "\u652F\u6301 .mp3\u3001.ogg\u3001.wav \u7B49\u97F3\u9891\u76F4\u94FE"
            ] }),
            /* @__PURE__ */ jsx2(
              "input",
              {
                value: mediaUrl,
                onChange: (e) => setMediaUrl(e.target.value),
                placeholder: mediaPanel === "image" ? "\u56FE\u7247 URL\u2026" : mediaPanel === "video" ? "\u89C6\u9891 URL\u2026" : "\u97F3\u9891 URL\u2026",
                className: "w-full h-8 rounded-md border border-input bg-background px-2 text-sm",
                onKeyDown: (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitMediaUrl();
                  }
                }
              }
            ),
            /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                className: "inline-flex items-center gap-1 h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50",
                onClick: commitMediaUrl,
                disabled: !mediaUrl.trim(),
                children: [
                  /* @__PURE__ */ jsx2(Check, { size: 14 }),
                  " \u63D2\u5165\u5230\u8F93\u5165\u6846"
                ]
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "flex gap-2 items-start", children: [
            /* @__PURE__ */ jsxs("div", { className: "flex-1 relative", children: [
              /* @__PURE__ */ jsx2(
                RichTextEditor_default,
                {
                  ref: editorRef,
                  placeholder: `\u5411 ${activeChannel.name} \u53D1\u9001\u6D88\u606F...`,
                  onSend: handleSendMessage,
                  onChange: handleEditorChange,
                  onAtTrigger: handleAtTrigger,
                  minHeight: "44px",
                  maxHeight: "200px"
                }
              ),
              atPopoverPosition && /* @__PURE__ */ jsx2(
                "div",
                {
                  className: "absolute z-50 rounded-lg border bg-popover shadow-md min-w-60 max-h-72 overflow-y-auto p-1",
                  style: { top: `${atPopoverPosition.top}px`, left: `${atPopoverPosition.left}px` },
                  children: filteredAtSuggestions.length > 0 ? filteredAtSuggestions.map((user) => /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 p-2 rounded-md cursor-pointer hover:bg-accent transition-colors", onClick: () => selectAtUser(user), children: [
                    /* @__PURE__ */ jsx2(User, { size: 16, className: "text-muted-foreground" }),
                    /* @__PURE__ */ jsxs("div", { className: "flex-1", children: [
                      /* @__PURE__ */ jsx2("div", { className: "text-sm font-medium", children: user.name }),
                      /* @__PURE__ */ jsxs("div", { className: "text-xs text-muted-foreground", children: [
                        "ID: ",
                        user.id
                      ] })
                    ] })
                  ] }, user.id)) : /* @__PURE__ */ jsxs("div", { className: "flex flex-col items-center gap-2 p-4", children: [
                    /* @__PURE__ */ jsx2(Search, { size: 20, className: "text-muted-foreground/50" }),
                    /* @__PURE__ */ jsx2("span", { className: "text-xs text-muted-foreground", children: "\u672A\u627E\u5230\u5339\u914D\u7684\u7528\u6237" })
                  ] })
                }
              )
            ] }),
            /* @__PURE__ */ jsxs(
              "button",
              {
                className: "inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 transition-colors hover:bg-primary/90",
                onClick: () => {
                  const c = editorRef.current?.getContent();
                  if (c) handleSendMessage(c.text, c.segments);
                },
                disabled: !hasRenderableSegments(previewSegments),
                children: [
                  /* @__PURE__ */ jsx2(Send, { size: 16 }),
                  " \u53D1\u9001"
                ]
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 flex-wrap text-xs text-muted-foreground", children: [
            /* @__PURE__ */ jsx2(Info, { size: 12 }),
            " \u5FEB\u6377\u64CD\u4F5C:",
            /* @__PURE__ */ jsx2("span", { className: "px-1 py-0.5 rounded border text-[10px]", children: "Enter" }),
            " \u53D1\u9001",
            /* @__PURE__ */ jsx2("span", { className: "px-1 py-0.5 rounded border text-[10px]", children: "Shift+Enter" }),
            " \u6362\u884C",
            /* @__PURE__ */ jsx2("span", { className: "px-1 py-0.5 rounded border text-[10px]", children: "[@\u540D\u79F0]" }),
            " @\u67D0\u4EBA",
            /* @__PURE__ */ jsx2("span", { className: "px-1 py-0.5 rounded border text-[10px]", children: "[video:URL]" }),
            /* @__PURE__ */ jsx2("span", { className: "px-1 py-0.5 rounded border text-[10px]", children: "[audio:URL]" })
          ] })
        ] })
      ] })
    ] })
  ] });
}

// pages/index.tsx
import { jsx as jsx3 } from "/esm/react~jsx-runtime.mjs?v=ms2oc1s3";
var meta = definePage({
  title: "\u6C99\u76D2",
  icon: "Box",
  order: 10
});
function SandboxPage() {
  return /* @__PURE__ */ jsx3(Sandbox, {});
}

// pages/index.register.tsx
var meta2 = meta;
function register(api) {
  const Component = SandboxPage?.default ?? SandboxPage;
  if (typeof Component !== "function" && (typeof Component !== "object" || Component == null)) {
    throw new Error("Page module default export is not a React component");
  }
  const m = meta && typeof meta === "object" ? meta : {};
  const route = "/";
  const name = typeof m.title === "string" && m.title ? m.title : "\u6C99\u76D2";
  const icon = m.icon ?? "Box";
  const element = api.React.createElement(Component);
  api.addRoute({
    path: route,
    name,
    element,
    ...icon != null ? { icon } : {},
    meta: { hideInMenu: m.hideInNav === true || false }
  });
  if (typeof api.addTool === "function") {
    api.addTool({
      id: "index",
      name,
      path: route,
      ...icon != null ? { icon } : {}
    });
  }
}
export {
  SandboxPage as default,
  meta2 as meta,
  register
};
/*! Bundled license information:

lucide-react/dist/esm/shared/src/utils.js:
lucide-react/dist/esm/defaultAttributes.js:
lucide-react/dist/esm/Icon.js:
lucide-react/dist/esm/createLucideIcon.js:
lucide-react/dist/esm/icons/bell.js:
lucide-react/dist/esm/icons/bot.js:
lucide-react/dist/esm/icons/check.js:
lucide-react/dist/esm/icons/hash.js:
lucide-react/dist/esm/icons/image.js:
lucide-react/dist/esm/icons/info.js:
lucide-react/dist/esm/icons/message-square.js:
lucide-react/dist/esm/icons/music.js:
lucide-react/dist/esm/icons/search.js:
lucide-react/dist/esm/icons/send.js:
lucide-react/dist/esm/icons/smile.js:
lucide-react/dist/esm/icons/trash-2.js:
lucide-react/dist/esm/icons/user-plus.js:
lucide-react/dist/esm/icons/user.js:
lucide-react/dist/esm/icons/users.js:
lucide-react/dist/esm/icons/video.js:
lucide-react/dist/esm/icons/wifi-off.js:
lucide-react/dist/esm/icons/wifi.js:
lucide-react/dist/esm/icons/x.js:
lucide-react/dist/esm/lucide-react.js:
  (**
   * @license lucide-react v0.525.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
