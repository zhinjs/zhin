import { build } from 'esbuild';
import vuePlugin from 'esbuild-plugin-vue3';
import { mkdir, cp, unlink, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { Renderer } from '@/renderer';
import htmlRenderer from '@/adapters/htmlRenderer';
import * as path from 'path';

export class VueRenderer extends Renderer {
  constructor(endpoint: string = process.env.ENDPOINT || '') {
    super(endpoint);
  }
  async rendering<T extends Renderer.OutputType>(
    input: string,
    options: VueRenderer.Options<T>,
  ): Promise<Renderer.Output<T>> {
    // 1. 检查入口文件是否正确
    if (!existsSync(input)) throw new Error('please input a valid vue entry file');
    const needRemoveFiles: string[] = [];
    const cleanFiles = () => {
      for (const file of needRemoveFiles) {
        unlink(file);
      }
    };
    try {
      const templatePath = path.resolve(__dirname, `..${path.sep}..${path.sep}template`);
      const entryTS = path.join(templatePath, 'app.ts');
      // 4. 生成入口ts
      let entryTSContent = await readFile(path.join(templatePath, 'entry.ts'), 'utf8');
      // 4.1 如果有props，进行数据注入
      if (options.props) entryTSContent = entryTSContent.replace('{}', JSON.stringify(options.props, null, 2));
      await writeFile(entryTS, entryTSContent, 'utf8');
      needRemoveFiles.push(entryTS);
      await cp(input, path.join(templatePath, `EntryComponent.vue`));
      needRemoveFiles.push(path.join(templatePath, `EntryComponent.vue`));
      if (options.files)
        needRemoveFiles.push(...(await this.copyFiles(templatePath, path.dirname(input), options.files)));
      // 5. 编译vue组件
      await build({
        entryPoints: [entryTS],
        bundle: true,
        outfile: path.join(templatePath, 'app.js'),

        plugins: [vuePlugin()],
      });
      needRemoveFiles.push(path.join(templatePath, 'app.js'));
      // 6 生成入口html
      let entryHTMLContent = await readFile(path.join(templatePath, 'index.html'), 'utf8');
      const outputJS = await readFile(path.join(templatePath, 'app.js'), 'utf8');
      if (existsSync(path.join(templatePath, 'app.css'))) {
        const cssFile = path.join(templatePath, 'app.css');
        entryHTMLContent = entryHTMLContent.replace('{{STYLE}}', await readFile(cssFile, 'utf8'));
        needRemoveFiles.push(cssFile);
      }
      entryHTMLContent = entryHTMLContent.replace('{{SCRIPT}}', outputJS);
      // 7. 渲染
      const result = await htmlRenderer.rendering(entryHTMLContent, options);
      // 清空临时文件夹
      cleanFiles();
      return result;
    } catch (e) {
      cleanFiles();
      throw e;
    }
  }
  async copyFiles(targetDir: string, entryPath: string, files: string[]) {
    const result: string[] = [];
    for (const filePath of files) {
      const filename = filePath.replace(`${entryPath}${path.sep}`, '');
      const targetPath = path.join(targetDir, filename);
      await cp(filePath, targetPath, { recursive: true });
      result.push(targetPath);
    }
    return result;
  }
}
export namespace VueRenderer {
  export interface Options<T extends Renderer.OutputType> extends Renderer.Options<T> {
    props?: Record<string, any>;
    files?: string[];
  }
}
export default new VueRenderer();
