/**
 * Shared syntax-highlighter module.
 *
 * Uses `PrismLight` with an explicit language allowlist instead of the full
 * `Prism` build (which eagerly ships ~270 languages). Only the languages
 * registered here will be highlighted; unregistered languages render as
 * plain unstyled code, which matches the previous fallback behavior for
 * unknown file extensions (e.g. `text`).
 *
 * Registration order matters: base languages must be registered before
 * dependents (e.g. `markup` → `javascript` → `jsx` → `typescript` → `tsx`).
 */
import { PrismLight } from 'react-syntax-highlighter';

// Base / structural
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import scss from 'react-syntax-highlighter/dist/esm/languages/prism/scss';
import less from 'react-syntax-highlighter/dist/esm/languages/prism/less';

// JS family (ordered by dependency)
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';

// Data / config
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import toml from 'react-syntax-highlighter/dist/esm/languages/prism/toml';
import ini from 'react-syntax-highlighter/dist/esm/languages/prism/ini';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';

// Shells / build
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker';
import makefile from 'react-syntax-highlighter/dist/esm/languages/prism/makefile';
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff';

// Scripting
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby';
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php';

// Systems / compiled
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';

// Query
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';

// Register canonical language names (order matters for dependents).
PrismLight.registerLanguage('markup', markup);
PrismLight.registerLanguage('css', css);
PrismLight.registerLanguage('scss', scss);
PrismLight.registerLanguage('less', less);

PrismLight.registerLanguage('javascript', javascript);
PrismLight.registerLanguage('jsx', jsx);
PrismLight.registerLanguage('typescript', typescript);
PrismLight.registerLanguage('tsx', tsx);

PrismLight.registerLanguage('json', json);
PrismLight.registerLanguage('yaml', yaml);
PrismLight.registerLanguage('toml', toml);
PrismLight.registerLanguage('ini', ini);
PrismLight.registerLanguage('markdown', markdown);

PrismLight.registerLanguage('bash', bash);
PrismLight.registerLanguage('docker', docker);
PrismLight.registerLanguage('makefile', makefile);
PrismLight.registerLanguage('diff', diff);

PrismLight.registerLanguage('python', python);
PrismLight.registerLanguage('ruby', ruby);
PrismLight.registerLanguage('php', php);

PrismLight.registerLanguage('c', c);
PrismLight.registerLanguage('cpp', cpp);
PrismLight.registerLanguage('csharp', csharp);
PrismLight.registerLanguage('go', go);
PrismLight.registerLanguage('rust', rust);
PrismLight.registerLanguage('java', java);
PrismLight.registerLanguage('kotlin', kotlin);
PrismLight.registerLanguage('swift', swift);

PrismLight.registerLanguage('sql', sql);

// Aliases — register the same language object under additional names so
// consumers can pass whatever identifier the source code / fence uses.
PrismLight.registerLanguage('html', markup);
PrismLight.registerLanguage('xml', markup);

PrismLight.registerLanguage('sh', bash);
PrismLight.registerLanguage('shell', bash);
PrismLight.registerLanguage('zsh', bash);

PrismLight.registerLanguage('md', markdown);
PrismLight.registerLanguage('yml', yaml);
PrismLight.registerLanguage('ts', typescript);
PrismLight.registerLanguage('js', javascript);

export const SyntaxHighlighter = PrismLight;

export {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
