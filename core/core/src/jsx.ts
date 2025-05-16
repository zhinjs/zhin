export interface JSXElement<P = any> {
  type: string | ((props: P) => JSXElement | JSXElement[] | string | number | null);
  props: P & { children?: JSXChild | JSXChild[] };
  key?: string | number | null;
}
export type JSXChild = JSXElement | string | number | boolean | null | undefined | JSXChild[];

/**
 * JSX Factory function
 * Used to create virtual DOM elements from JSX
 */
export function h<P = any>(
  type: string | ((props: P) => JSXElement | JSXElement[] | string | number | null),
  props?: P | null,
  ...children: JSXChild[]
): JSXElement<P> {
  const result: JSXElement<P> = {
    type,
    props: { ...props } as P & { children?: JSXChild | JSXChild[] },
  };

  if (children.length) {
    result.props.children = children.length === 1 ? children[0] : children;
  }

  return result;
}

/**
 * Fragment component for JSX
 * Allows returning multiple elements without a wrapper
 */
export function Fragment(props: { children?: JSXChild | JSXChild[] }): JSXChild[] {
  return Array.isArray(props.children) ? props.children : props.children ? [props.children] : [];
}

/**
 * Convert JSX to string representation
 * Useful for debugging and testing JSX output
 */
export function renderToString(element: JSXChild): string {
  if (element == null || element === false) return '';
  
  if (typeof element === 'string' || typeof element === 'number') {
    return String(element);
  }
  
  if (Array.isArray(element)) {
    return element.map(renderToString).join('');
  }
  
  if (element && typeof element === 'object') {
    if (typeof element.type === 'function') {
      // Component
      return renderToString(element.type(element.props));
    }
    
    // Regular element
    const { type, props } = element;
    if(type==='text') return props.text
    const children = props.children ? renderToString(props.children) : '';
    const attributes = Object.entries(props)
      .filter(([key]) => key !== 'children')
      .map(([key, value]) => {
        if (key.startsWith('on') && typeof value === 'function') {
          // Event handlers are functions
          return ''; // Don't render event handlers in string output
        }
        if (key === 'className') {
          return ` class="${value}"`;
        }
        if (value === true) {
          return ` ${key}`;
        }
        if (value === false || value == null) {
          return '';
        }
        return ` ${key}="${String(value).replace(/"/g, '&quot;')}"`;
      })
      .join('');
    return `<${type}${attributes}>${children}</${type}>`;
  }
  
  return '';
}

// Export for automatic JSX runtime
export const jsx = h;
export const jsxs = h;
export const jsxDEV = h;

// Add to module exports
export default {
  createElement: h,
  Fragment,
  h,
  renderToString,
};
