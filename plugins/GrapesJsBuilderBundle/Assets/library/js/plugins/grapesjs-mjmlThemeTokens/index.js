import { pluginId, extractMjHeadContent, createHeadInjectingMjmlParser } from './utils';
import { patchBlocks, createBlockPatcher } from './blocks';

export { pluginId, extractMjHeadContent, createHeadInjectingMjmlParser };

export default (editor, opts = {}) => {
  const options = {
    // Provide mj-head inner content (preferred) or full original MJML
    headContent: '',
    originalMjml: '',

    // Default token mapping for newly dropped components
    defaults: {
      text: 't-body',
      heading1: 't-h1',
      heading2: 't-h2',
      heading3: 't-h3',
      heading4: 't-h4',
      subtitle: 't-lead',
      button: 't-btn t-btn-primary',
      buttonSecondary: 't-btn t-btn-secondary',
      section: 't-section t-surface-1',
    },

    // Types to auto-apply defaults to
    applyDefaultsToTypes: ['mj-text', 'mj-button', 'mj-section'],

    ...opts,
  };

  const headContent = options.headContent || extractMjHeadContent(options.originalMjml || '');

  const parseMjClassNames = (mjHeadContent) => {
    const out = new Set();
    if (!mjHeadContent) return out;

    const re = /<mj-class\s+[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = re.exec(mjHeadContent)) !== null) out.add(m[1]);
    return out;
  };

  const classNames = parseMjClassNames(headContent);

  const registerHiddenMjAttributesTypes = () => {
    const isTag = (el, tag) => (el?.tagName || '').toLowerCase() === tag;
    const parentIs = (el, tag) => isTag(el?.parentElement, tag);

    const hiddenDefaults = {
      selectable: false,
      hoverable: false,
      highlightable: false,
      layerable: false,
      draggable: false,
      droppable: false,
      copyable: false,
      removable: false,
      editable: false,
    };

    const hiddenView = {
      tagName: 'div',
      attributes: { style: 'display:none !important;' },
      getTemplateFromMjml() {
        return '';
      },
      render() {
        this.el.innerHTML = '';
        return this;
      },
    };

    // Container <mj-attributes>
    editor.DomComponents.addType('mj-attributes', {
      isComponent: (el) => isTag(el, 'mj-attributes'),
      model: {
        defaults: {
          tagName: 'mj-attributes',
          ...hiddenDefaults,
        },
      },
      view: hiddenView,
    });

    // Leaf tags inside <mj-attributes>
    editor.DomComponents.addType('mj-all', {
      isComponent: (el) => isTag(el, 'mj-all') && parentIs(el, 'mj-attributes'),
      model: {
        defaults: {
          tagName: 'mj-all',
          void: false,
          ...hiddenDefaults,
        },
      },
      view: hiddenView,
    });

    editor.DomComponents.addType('mj-class', {
      isComponent: (el) => isTag(el, 'mj-class') && parentIs(el, 'mj-attributes'),
      model: {
        defaults: {
          tagName: 'mj-class',
          void: false,
          ...hiddenDefaults,
        },
      },
      view: hiddenView,
    });

    // Head-default tags like <mj-text ...></mj-text> inside <mj-attributes>
    // Extend the existing body types (must exist => plugin must run AFTER grapesjs-mjml)
    const addHiddenAttrType = (typeName, baseType, tagName) => {
      editor.DomComponents.addType(typeName, {
        extend: baseType,
        isComponent: (el) => isTag(el, tagName) && parentIs(el, 'mj-attributes'),
        model: {
          defaults: {
            tagName,
            ...hiddenDefaults,
          },
        },
        view: hiddenView,
      });
    };

    addHiddenAttrType('mj-attr-text', 'mj-text', 'mj-text');
    addHiddenAttrType('mj-attr-button', 'mj-button', 'mj-button');
    addHiddenAttrType('mj-attr-section', 'mj-section', 'mj-section');
    addHiddenAttrType('mj-attr-column', 'mj-column', 'mj-column');
  };

  const stripDefaultAttrsForComponent = (component) => {
    if (!component) return;

    const attrs = { ...(component.get('attributes') || {}) };
    const styleDefault = component.get('style-default') || {};

    let changed = false;
    Object.keys(styleDefault).forEach((key) => {
      if (key in attrs && attrs[key] === styleDefault[key]) {
        delete attrs[key];
        changed = true;
      }
    });

    if (changed) {
      component.set('attributes', attrs);
    }
  };

  const stripDefaultAttrsForTokenizedComponents = () => {
    const wrapper = editor.getWrapper?.();
    if (!wrapper) return;

    const walk = (cmp) => {
      const attrs = { ...(cmp.get('attributes') || {}) };
      if (attrs['mj-class']) stripDefaultAttrsForComponent(cmp);

      const children = cmp.components?.();
      if (children && children.length) children.forEach((c) => walk(c));
    };

    wrapper.components?.().forEach((c) => walk(c));
  };

  // When a component has a padding/border shorthand attribute, the sub-properties
  // added by coreMjmlModel.init() from style-default override the shorthand in MJML
  // rendering. Strip default sub-properties when the shorthand is explicitly set.
  const stripConflictingDefaultSubProperties = () => {
    const wrapper = editor.getWrapper?.();
    if (!wrapper) return;

    const shorthandMap = {
      padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
      border: ['border-top', 'border-right', 'border-bottom', 'border-left'],
    };

    const walk = (cmp) => {
      const attrs = cmp.get('attributes') || {};
      const styleDefault = cmp.get('style-default') || {};
      let changed = false;
      const newAttrs = { ...attrs };

      Object.entries(shorthandMap).forEach(([shorthand, subProps]) => {
        if (attrs[shorthand]) {
          subProps.forEach((sub) => {
            if (sub in newAttrs && styleDefault[sub] && newAttrs[sub] === styleDefault[sub]) {
              delete newAttrs[sub];
              changed = true;
            }
          });
        }
      });

      if (changed) {
        cmp.set('attributes', newAttrs);
      }

      const children = cmp.components?.();
      if (children && children.length) children.forEach((c) => walk(c));
    };

    wrapper.components?.().forEach((c) => walk(c));
  };

  const getDefaultMjClassForType = (type) => {
    if (type === 'mj-text') return options.defaults.text || '';
    if (type === 'mj-button') return options.defaults.button || '';
    if (type === 'mj-section') return options.defaults.section || '';
    return '';
  };

  // Apply defaults only AFTER initial content import is done
  let readyForNewDrops = false;

  const onComponentAdd = (component) => {
    if (!readyForNewDrops) return;

    const type = component?.get?.('type');
    if (!type || !options.applyDefaultsToTypes.includes(type)) return;

    const attrs = { ...(component.get('attributes') || {}) };

    // If block didn't specify mj-class, apply theme token (only if token exists in theme)
    if (!attrs['mj-class'] && classNames.size) {
      const token = getDefaultMjClassForType(type);
      if (token) {
        const parts = token.split(/\s+/).filter(Boolean);
        const allExist = parts.every((p) => classNames.has(p));
        if (allExist) {
          component.set('attributes', { ...attrs, 'mj-class': token });
        }
      }
    }

    // Always strip defaults on new drops (lets theme <mj-attributes> and/or mj-class win)
    stripDefaultAttrsForComponent(component);
  };

  // --- mj-column mj-class visual styling ---
  //
  // MJML's mj-column puts background-color, border, and padding on inner elements
  // (gutter td / inner table), NOT on the outer div. The grapesjs-mjml view's
  // renderStyle() only applies the model's explicit style properties to the outer div.
  // When a column uses mj-class, those properties aren't in the model's style object,
  // so they never appear visually in the editor.
  //
  // Solution: Parse the mj-class definitions from mj-head, and when rendering a column
  // that has mj-class, merge the resolved class properties into the rendered style.

  const parseMjClassDefinitions = (mjHeadContent) => {
    const defs = new Map();
    if (!mjHeadContent) return defs;

    const re = /<mj-class\s+([^>]*)>/gi;
    let match;
    while ((match = re.exec(mjHeadContent)) !== null) {
      const attrStr = match[1];
      const nameMatch = attrStr.match(/\bname\s*=\s*["']([^"']+)["']/i);
      if (!nameMatch) continue;

      const name = nameMatch[1];
      const attrs = {};
      const attrRe = /(\w[\w-]*)\s*=\s*["']([^"']*)["']/gi;
      let a;
      while ((a = attrRe.exec(attrStr)) !== null) {
        if (a[1].toLowerCase() !== 'name') {
          attrs[a[1].toLowerCase()] = a[2];
        }
      }
      defs.set(name, attrs);
    }
    return defs;
  };

  let mjClassDefsCache = parseMjClassDefinitions(headContent);

  const refreshMjClassDefs = () => {
    try {
      const currentMjml = editor.getHtml?.({ cleanId: true }) || '';
      const currentHead = extractMjHeadContent(currentMjml);
      if (currentHead) {
        mjClassDefsCache = parseMjClassDefinitions(currentHead);
      }
    } catch (e) {
      // Silently fall back to existing cache if getHtml fails during transitions
    }
  };

  // Refresh cache + update parser + re-render when content is replaced via code editor
  editor.on('mautic:code-editor-update', () => {
    // Update the mjmlParser's head content so mj-text, mj-button etc. get new styles
    if (options.mjmlParser && typeof options.mjmlParser.updateHeadContent === 'function') {
      try {
        const currentMjml = editor.getHtml?.({ cleanId: true }) || '';
        const currentHead = extractMjHeadContent(currentMjml);
        if (currentHead) {
          options.mjmlParser.updateHeadContent(currentHead);
        }
      } catch (e) {
        // silently ignore
      }
    }

    refreshMjClassDefs();

    // Re-render all component views that use mj-class so they pick up new definitions
    const mjClassAwareTypes = new Set(['mj-column', 'mj-text', 'mj-button', 'mj-section']);
    const wrapper = editor.getWrapper?.();
    if (wrapper) {
      const walk = (cmp) => {
        const type = cmp.get('type');
        const attrs = cmp.get('attributes') || {};
        if (mjClassAwareTypes.has(type) && attrs['mj-class'] && cmp.view) {
          cmp.view.render();
        }
        const children = cmp.components?.();
        if (children && children.length) children.forEach((c) => walk(c));
      };
      wrapper.components?.().forEach((c) => walk(c));
    }
  });

  const getColumnMjClassDefs = () => mjClassDefsCache;

  const patchMjColumnView = () => {
    const columnType = editor.DomComponents.getType('mj-column');
    if (!columnType) return;

    editor.DomComponents.addType('mj-column', {
      view: {
        renderStyle() {
          const { model, attributes, el } = this;
          const style = model.get('style') || {};
          const stylable = model.get('stylable');

          const modelAttrs = model.get('attributes') || {};
          const mjClassValue = modelAttrs['mj-class'] || '';
          const resolvedClassStyles = {};

          if (mjClassValue) {
            const currentDefs = getColumnMjClassDefs();
            if (currentDefs.size) {
              const classTokens = mjClassValue.split(/\s+/).filter(Boolean);
              classTokens.forEach((token) => {
                const def = currentDefs.get(token);
                if (def) {
                  Object.entries(def).forEach(([key, value]) => {
                    resolvedClassStyles[key] = value;
                  });
                }
              });
            }
          }

          const inlineOverrides = Object.keys(style)
            .filter((key) => stylable.indexOf(key) > -1)
            .map((key) => `${key}:${style[key]};`);

          const columnVisualProps = [
            'background-color',
            'border',
            'border-top',
            'border-right',
            'border-bottom',
            'border-left',
            'border-radius',
            'border-top-left-radius',
            'border-top-right-radius',
            'border-bottom-left-radius',
            'border-bottom-right-radius',
            'padding',
            'padding-top',
            'padding-right',
            'padding-bottom',
            'padding-left',
            'vertical-align',
          ];

          const classStyleDecls = columnVisualProps
            .filter((prop) => resolvedClassStyles[prop] && !style[prop])
            .map((prop) => `${prop}:${resolvedClassStyles[prop]};`);

          const viewStyle = attributes.style || '';
          const currentElStyle = el.getAttribute('style') || '';
          const combined =
            `${viewStyle} ${classStyleDecls.join(' ')} ${inlineOverrides.join(' ')} ${currentElStyle}`
              .trim();
          el.setAttribute('style', combined);

          const firstChild = el.firstElementChild;
          if (firstChild) {
            firstChild.setAttribute('style', '');
          }
          this.checkVisibility();
        },
      },
    });
  };

  // Must be executed during init (before setComponents) so mj-attributes content is hidden on parse
  registerHiddenMjAttributesTypes();
  patchMjColumnView();

  editor.on('component:add', onComponentAdd);

  const patchBlocksWithContext = createBlockPatcher({
    editor,
    options,
    classNames,
  });

  // Patch blocks when they appear (preset plugins may add them later)
  editor.on('load', patchBlocksWithContext);
  const blockColl = editor.BlockManager.getAll?.();
  if (blockColl?.on) {
    blockColl.on('add reset', patchBlocksWithContext);
  }

  // Service will call this after its setComponents + reparse workaround
  editor.on('mjml-theme-tokens:content:ready', () => {
    stripDefaultAttrsForTokenizedComponents();
    stripConflictingDefaultSubProperties();
    patchBlocksWithContext();
    readyForNewDrops = true;
  });
};
