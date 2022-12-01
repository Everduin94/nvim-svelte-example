import { Plugin, normalizePath } from 'vite';
// import { log } from '../log';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { idToFile } from './utils';
import { exec } from 'child_process'

export interface InspectorOptions {
  /**
   * define a key combo to toggle inspector,
   * @default 'control-shift' on windows, 'meta-shift' on other os
   *
   * any number of modifiers `control` `shift` `alt` `meta` followed by zero or one regular key, separated by -
   * examples: control-shift, control-o, control-alt-s  meta-x control-meta
   * Some keys have native behavior (e.g. alt-s opens history menu on firefox).
   * To avoid conflicts or accidentally typing into inputs, modifier only combinations are recommended.
   */
  toggleKeyCombo?: string;

  /**
   * define keys to select elements with via keyboard
   * @default {parent: 'ArrowUp', child: 'ArrowDown', next: 'ArrowRight', prev: 'ArrowLeft' }
   *
   * improves accessibility and also helps when you want to select elements that do not have a hoverable surface area
   * due to tight wrapping
   *
   * A note for users of screen-readers:
   * If you are using arrow keys to navigate the page itself, change the navKeys to avoid conflicts.
   * e.g. navKeys: {parent: 'w', prev: 'a', child: 's', next: 'd'}
   *
   *
   * parent: select closest parent
   * child: select first child (or grandchild)
   * next: next sibling (or parent if no next sibling exists)
   * prev: previous sibling (or parent if no prev sibling exists)
   */
  navKeys?: { parent: string; child: string; next: string; prev: string };

  /**
   * define key to open the editor for the currently selected dom node
   *
   * @default 'Enter'
   */
  openKey?: string;

  /**
   * inspector is automatically disabled when releasing toggleKeyCombo after holding it for a longpress
   * @default false
   */
  holdMode?: boolean;
  /**
   * when to show the toggle button
   * @default 'active'
   */
  showToggleButton?: 'always' | 'active' | 'never';

  /**
   * where to display the toggle button
   * @default top-right
   */
  toggleButtonPos?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

  /**
   * inject custom styles when inspector is active
   */
  customStyles?: boolean;

  /**
   * append an import to the module id ending with `appendTo` instead of adding a script into body
   * useful for frameworks that do not support trannsformIndexHtml hook
   *
   * WARNING: only set this if you know exactly what it does.
   * Regular users of vite-plugin-svelte or SvelteKit do not need it
   */
  appendTo?: string;
}

const defaultInspectorOptions: InspectorOptions = {
  toggleKeyCombo: process.platform === 'win32' ? 'control-shift' : 'meta-shift',
  navKeys: { parent: 'ArrowUp', child: 'ArrowDown', next: 'ArrowRight', prev: 'ArrowLeft' },
  openKey: 'Enter',
  holdMode: false,
  showToggleButton: 'active',
  toggleButtonPos: 'top-right',
  customStyles: true
};

function getInspectorPath() {
  const pluginPath = normalizePath(path.dirname(fileURLToPath(import.meta.url)));
  return pluginPath.replace(/\/vite-plugin-svelte\/dist$/, '/vite-plugin-svelte/src/ui/inspector/');
}

export function svelteInspector(): Plugin {
  const inspectorPath = getInspectorPath() + '/';
  // log.debug.enabled && log.debug(`svelte inspector path: ${inspectorPath}`);
  let inspectorOptions: InspectorOptions;
  let appendTo: string | undefined;
  let disabled = false;

  return {
    name: 'vite-plugin-svelte:inspector',
    apply: 'serve',
    enforce: 'pre',

    configResolved(config) {
      const vps = config.plugins.find((p) => p.name === 'vite-plugin-svelte');
      if (vps?.api?.options?.experimental?.nvim_inspector) {
        inspectorOptions = {
          ...defaultInspectorOptions,
          ...vps.api.options.experimental.nvim_inspector
        };
      }
      if (!vps || !inspectorOptions) {
        // log.debug('inspector disabled, could not find config');
        disabled = true;
      } else {
        if (vps.api.options.kit && !inspectorOptions.appendTo) {
          const out_dir = path.basename(vps.api.options.kit.outDir || '.svelte-kit');
          inspectorOptions.appendTo = `${out_dir}/generated/root.svelte`;
        }
        appendTo = inspectorOptions.appendTo;
      }
    },
    configureServer(server) {
      server.ws.on('my:from-client', (data) => {
        const msg = data.msg ?? ''
        const file = msg.substring(0, msg.indexOf(':'))
        const row = msg.substring(msg.indexOf(':') + 1, msg.lastIndexOf(':')) || '0'
        exec(`nvim --server ~/.cache/nvim/server.pipe --remote ` + file, () => {
          exec(`nvim --server ~/.cache/nvim/server.pipe --remote-send '${row}<s-g>'`);
        });
      })
    },

    async resolveId(importee: string, options) {
      if (options?.ssr || disabled) {
        return;
      }
      if (importee.startsWith('virtual:svelte-inspector-options')) {
        return importee;
      } else if (importee.startsWith('virtual:svelte-inspector-path:')) {
        const resolved = importee.replace('virtual:svelte-inspector-path:', inspectorPath);
        // log.debug.enabled && log.debug(`resolved ${importee} with ${resolved}`);
        return resolved;
      }
    },

    async load(id, options) {
      if (options?.ssr || disabled) {
        return;
      }
      if (id === 'virtual:svelte-inspector-options') {
        return `export default ${JSON.stringify(inspectorOptions ?? {})}`;
      } else if (id.startsWith(inspectorPath)) {
        // read file ourselves to avoid getting shut out by vites fs.allow check
        const file = idToFile(id);
        if (fs.existsSync(file)) {
          return await fs.promises.readFile(file, 'utf-8');
        } else {
          // log.error(`failed to find file for svelte-inspector: ${file}, referenced by id ${id}.`);
        }
      }
    },

    transform(code: string, id: string, options?: { ssr?: boolean }) {
      if (options?.ssr || disabled || !appendTo) {
        return;
      }
      if (id.endsWith(appendTo)) {
        return { code: `${code}\nimport 'virtual:svelte-inspector-path:load-inspector.js'` };
      }
    },
    transformIndexHtml(html) {
      if (disabled || appendTo) {
        return;
      }
      return {
        html,
        tags: [
          {
            tag: 'script',
            injectTo: 'body',
            attrs: {
              type: 'module',
              // /@id/ is needed, otherwise the virtual: is seen as protocol by browser and cors error happens
              src: '/@id/virtual:svelte-inspector-path:load-inspector.js'
            }
          }
        ]
      };
    }
  };
}
