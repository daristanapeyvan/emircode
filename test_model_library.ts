/**
 * test_model_library.ts
 * The online model library of the Models window: parsing ollama.com's list and tags pages (real,
 * trimmed samples in test_fixtures/ollama), sizes and quantizations, categories, the fit for this
 * computer, and the automatic behaviour of the store (cache, offline fallback, registry checks).
 *
 * Run: node scripts/run-ts-test.mjs test_model_library.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  MODEL_NAME_RE,
  MODEL_TAG_RE,
  builtinLibrary,
  builtinVariants,
  categoriesOf,
  decodeEntities,
  groupVariants,
  hardwareFit,
  isCommonQuant,
  isLocal,
  memoryNeedGb,
  modelsFor,
  parseByteLabel,
  parseCount,
  parseLibraryHtml,
  parseTagsHtml,
  pickSize,
  quantOf,
  quantTier,
  sameDigest,
  sizeToBillions,
  splitTag,
} from './src/lib/ollama/library';
import { MIN_LIBRARY_MODELS, useModelLibraryStore } from './src/stores/modelLibraryStore';

let passed = 0;
const failures: string[] = [];
function check(condition: boolean, message: string, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`✅ ${message}`);
  } else {
    failures.push(message);
    console.log(`❌ ${message}`);
    if (detail !== undefined) console.log('   →', typeof detail === 'string' ? detail : JSON.stringify(detail, null, 1)?.slice(0, 1500));
  }
}
const section = (title: string) => console.log(`\n--- ${title} ---`);

const LIBRARY_HTML = fs.readFileSync(path.join('test_fixtures', 'ollama', 'library.html'), 'utf8');
const TAGS_HTML = fs.readFileSync(path.join('test_fixtures', 'ollama', 'tags_qwen3.html'), 'utf8');

async function main() {
  // ---------------------------------------------------------------------------
  section('1. The list page of ollama.com');
  // ---------------------------------------------------------------------------
  const models = parseLibraryHtml(LIBRARY_HTML);
  const byName = (n: string) => models.find((m) => m.name === n)!;
  check(
    models.map((m) => m.name).join(',') === 'qwen3,gemma4,nomic-embed-text,qwen2.5-coder,deepseek-r1,llama3.2-vision,minimax-m2.7',
    'Every model of the page is read, in its order',
    models.map((m) => m.name)
  );
  const qwen3 = byName('qwen3');
  check(
    qwen3.sizes.join(',') === '0.6b,1.7b,4b,8b,14b,30b,32b,235b' && qwen3.capabilities.join(',') === 'tools,thinking' && !qwen3.cloud,
    'Sizes and capabilities come from their labels',
    qwen3
  );
  check(qwen3.pulls === 38_000_000 && qwen3.pullsLabel === '38M' && qwen3.tagCount === 58 && /2025/.test(qwen3.updated), 'Pull count, tag count and update date are read', qwen3);
  check(/^Qwen3 is the latest generation/.test(qwen3.description), 'The description is read without its markup', qwen3.description);
  const gemma4 = byName('gemma4');
  check(
    gemma4.cloud && !gemma4.sizes.includes('cloud') && gemma4.sizes.includes('e2b') && gemma4.capabilities.includes('audio') && gemma4.capabilities.includes('vision'),
    'A "cloud" label is not a size; "e2b" is; audio and vision are capabilities',
    gemma4
  );
  const minimax = byName('minimax-m2.7');
  check(minimax.description.startsWith("MiniMax's M2-series") && !isLocal(minimax), 'Entities are decoded; a cloud-only model is not offered for download', minimax);
  check(isLocal(byName('nomic-embed-text')) && byName('nomic-embed-text').sizes.length === 0, 'An embedding model without size labels stays downloadable');
  check(decodeEntities('a &amp; b &#39;c&#39; &quot;d&quot; &nbsp;e &#x41;') === `a & b 'c' "d"  e A`, 'HTML entities are decoded');

  // ---------------------------------------------------------------------------
  section('2. The tags page: sizes and quantizations');
  // ---------------------------------------------------------------------------
  const variants = parseTagsHtml('qwen3', TAGS_HTML);
  check(variants.length === 9, 'Each tag is read once (the page shows every tag twice)', variants.map((v) => v.tag));
  const q8 = variants.find((v) => v.name === '8b-q8_0')!;
  check(
    q8.digest === 'e56358ca25dd' && q8.bytes === 8.9e9 && q8.sizeLabel === '8.9GB' && q8.context === '40K' && q8.input === 'Text' && q8.quant === 'q8_0' && q8.group === '8b',
    'A tag carries its digest, file size, context window, input and quantization',
    q8
  );
  const groups = groupVariants('qwen3', variants);
  check(groups.map((g) => g.size).join(',') === '0.6b,8b,30b,235b', 'Sizes are ordered by parameter count', groups.map((g) => g.size));
  const g8 = groups.find((g) => g.size === '8b')!;
  check(
    g8.latest &&
      g8.options.map((o) => o.variant.name).join(',') === '8b,8b-q8_0,8b-fp16' &&
      g8.options[0].isDefault &&
      g8.options[0].aliases.join() === 'qwen3:8b-q4_K_M' &&
      g8.options[0].quant === 'q4_K_M',
    'Tags with the same digest are one choice: the default "8b" is the q4_K_M file; "latest" points to 8b',
    g8.options.map((o) => ({ tag: o.variant.tag, def: o.isDefault, aliases: o.aliases, quant: o.quant }))
  );
  const g30 = groups.find((g) => g.size === '30b')!;
  check(
    g30.options.some((o) => o.variant.suffix === 'a3b-instruct-2507-q4_K_M' && o.quant === 'q4_K_M'),
    'Other versions of a size (instruct, MoE) keep their full tag and quantization',
    g30.options.map((o) => o.variant.tag)
  );
  // Many models name quantizations after a build: qwen2.5-coder "7b-instruct-q8_0", gemma3 "4b-it-qat".
  const row = (model: string, name: string, digest: string, size: string) =>
    `<div class="group px-4 py-3"><a href="/library/${model}:${name}" class="md:hidden"><span>${model}:${name}</span><span><span class="font-mono">${digest}</span> · ${size} · 32K context window · Text input · 1 year ago</span></a></div>`;
  const coderHtml = [
    ['7b', 'dae161e27b0e', '4.7GB'],
    ['7b-instruct', 'dae161e27b0e', '4.7GB'],
    ['7b-instruct-q4_K_M', 'dae161e27b0e', '4.7GB'],
    ['7b-instruct-q3_K_S', '333333333333', '3.5GB'],
    ['7b-instruct-q8_0', '111111111111', '8.1GB'],
    ['7b-instruct-fp16', '222222222222', '15GB'],
    ['7b-base', '444444444444', '4.7GB'],
    ['7b-base-q4_K_M', '444444444444', '4.7GB'],
    ['7b-base-q8_0', '555555555555', '8.1GB'],
  ]
    .map(([n, d, s]) => row('qwen2.5-coder', n, d, s))
    .join('\n');
  const coder = groupVariants('qwen2.5-coder', parseTagsHtml('qwen2.5-coder', coderHtml))[0];
  const coderMain = coder.options.filter((o) => o.isDefault || (o.family === coder.family && isCommonQuant(o.quant)));
  check(
    coder.family === 'instruct' &&
      coderMain.map((o) => o.variant.name).join(',') === '7b,7b-instruct-q8_0,7b-instruct-fp16' &&
      coder.options.find((o) => o.variant.name === '7b-base')?.family === 'base',
    'The default\'s build (instruct) gives the main quantization choices; rare ones (q3) and other builds (base) are folded',
    coder.options.map((o) => `${o.variant.name}|${o.family}|${o.quant}`)
  );
  const gemma = groupVariants(
    'gemma3',
    parseTagsHtml(
      'gemma3',
      [
        ['4b', 'a2af6cc3eb7f', '3.3GB'],
        ['4b-it-q4_K_M', 'a2af6cc3eb7f', '3.3GB'],
        ['4b-it-qat', 'aaaaaaaaaaaa', '4.0GB'],
        ['4b-it-q8_0', 'bbbbbbbbbbbb', '5.0GB'],
      ]
        .map(([n, d, s]) => row('gemma3', n, d, s))
        .join('\n')
    )
  )[0];
  check(
    gemma.family === 'it' && gemma.options.filter((o) => o.family === 'it' && isCommonQuant(o.quant)).map((o) => o.quant).join(',') === 'q4_K_M,qat,q8_0',
    'Quantization-aware (QAT) builds are a main choice too',
    gemma.options.map((o) => `${o.variant.name}|${o.family}|${o.quant}`)
  );
  check(
    quantOf('8b-q4_K_M') === 'q4_K_M' && quantOf('e2b-it-q8_0') === 'q8_0' && quantOf('14b-fp16') === 'fp16' && quantOf('30b-a3b') === null && quantOf('latest') === null,
    'Quantization is read from the end of a tag'
  );
  check(
    quantTier('q4_K_M') === 'balanced' && quantTier('q8_0') === 'near-lossless' && quantTier('fp16') === 'full' && quantTier('q5_K_S') === 'better' && quantTier('q2_K') === 'tiny' && quantTier(null) === null,
    'Quantizations are explained by their quality/size class'
  );

  // ---------------------------------------------------------------------------
  section('3. Units, digests and names');
  // ---------------------------------------------------------------------------
  check(
    sizeToBillions('0.6b') === 0.6 && sizeToBillions('270m') === 0.27 && sizeToBillions('e2b') === 2 && sizeToBillions('8x7b') === 56 && sizeToBillions('cloud') === null,
    'Parameter sizes: 0.6b, 270m, e2b, 8x7b'
  );
  check(parseCount('38M') === 38e6 && parseCount('655.2K') === 655200 && parseCount('1,234') === 1234, 'Pull counts: 38M, 655.2K');
  check(parseByteLabel('5.2GB') === 5.2e9 && parseByteLabel('523MB') === 523e6 && parseByteLabel('x') === null, 'File sizes in decimal units, as ollama.com shows them');
  check(
    sameDigest('500a1f067a9f', '500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41') &&
      sameDigest('sha256:500A1F067A9F7826', '500a1f067a9f') &&
      !sameDigest('500a1f067a9f', 'e56358ca25dd') &&
      !sameDigest('500a1f', '500a1f'),
    'Digests match on the 12-character short form; too short never matches'
  );
  check(
    MODEL_NAME_RE.test('qwen2.5-coder') && !MODEL_NAME_RE.test('../etc') && !MODEL_NAME_RE.test('a b') && MODEL_TAG_RE.test('8b-q4_K_M') && !MODEL_TAG_RE.test('8b/../x'),
    'Model and tag names are checked before any request'
  );
  check(splitTag('qwen3:8b').tag === '8b' && splitTag('mistral-nemo').tag === 'latest' && splitTag('user/model:v1').model === 'user/model', 'A full tag is split into model and tag');

  // ---------------------------------------------------------------------------
  section('4. This computer');
  // ---------------------------------------------------------------------------
  const pc16 = { ramGb: 15.9 };
  check(
    hardwareFit(5.2e9, pc16) === 'comfortable' && hardwareFit(8.9e9, pc16) === 'tight' && hardwareFit(20e9, pc16) === 'too-large' && hardwareFit(null, pc16) === 'unknown',
    'Fit on a 16 GB computer: 5.2 GB comfortable, 8.9 GB tight, 20 GB too large'
  );
  check(
    hardwareFit(18e9, { ramGb: 16, vramGb: 24 }) === 'comfortable' && hardwareFit(20e9, { ramGb: 16, vramGb: 24 }) === 'too-large',
    'A model that fits in the graphics memory runs comfortably (18 GB needs ~22.6 GB; 20 GB needs ~25 GB)'
  );
  check(Math.abs(memoryNeedGb(5.2e9) - 7.24) < 0.01, 'Memory need = file size + room for the context');
  check(
    pickSize(groups, pc16) === '8b' && pickSize(groups, { ramGb: 8 }) === '0.6b' && pickSize(groups, { ramGb: 64 }) === '30b',
    'The preselected size is the largest one that runs comfortably here (16 GB → 8b, 8 GB → 0.6b, 64 GB → 30b)',
    [pickSize(groups, pc16), pickSize(groups, { ramGb: 8 }), pickSize(groups, { ramGb: 64 })]
  );

  // ---------------------------------------------------------------------------
  section('5. Categories by type and use');
  // ---------------------------------------------------------------------------
  const cats = (n: string) => categoriesOf(byName(n));
  check(cats('qwen2.5-coder').includes('coding') && cats('qwen2.5-coder').includes('recommended') && !cats('qwen2.5-coder').includes('chat'), 'A code model is under Coding (and Recommended), not general chat', cats('qwen2.5-coder'));
  check(cats('deepseek-r1').includes('reasoning') && cats('deepseek-r1').includes('agent') && cats('deepseek-r1').includes('small'), 'deepseek-r1: reasoning, tools, has a 1.5B size', cats('deepseek-r1'));
  check(cats('nomic-embed-text').join(',') === 'embedding,all', 'An embedding model is only under Embedding', cats('nomic-embed-text'));
  check(cats('llama3.2-vision').includes('vision') && cats('gemma4').includes('vision'), 'Image and audio models are under Vision & audio');
  check(!modelsFor(models, 'all').some((m) => m.name === 'minimax-m2.7'), 'Cloud-only models are in no category');
  check(modelsFor(models, 'recommended').map((m) => m.name).join(',') === 'qwen2.5-coder,qwen3,deepseek-r1', 'Recommended models keep the order of our own benchmark', modelsFor(models, 'recommended').map((m) => m.name));
  check(modelsFor(models, 'all', 'CODER').map((m) => m.name)[0] === 'qwen2.5-coder' && modelsFor(models, 'all', 'görüntü').length === 0, 'Search looks at names and descriptions, case-insensitive');

  // ---------------------------------------------------------------------------
  section('6. Built-in list when ollama.com cannot be reached');
  // ---------------------------------------------------------------------------
  const builtin = builtinLibrary();
  check(
    builtin.length === 8 && builtin.every((m) => m.sizes.length >= 1 && isLocal(m)) && builtin.find((m) => m.name === 'gemma2')?.sizes.join(',') === '2b,9b',
    'The built-in list has one card per curated model with its tested sizes',
    builtin.map((m) => `${m.name}:${m.sizes.join('/')}`)
  );
  check(builtinVariants('gemma2').map((v) => v.tag).join(',') === 'gemma2:2b,gemma2:9b', 'Offline, a model with two tested sizes offers both', builtinVariants('gemma2'));
  const bv = builtinVariants('qwen2.5-coder');
  check(bv.length === 1 && bv[0].tag === 'qwen2.5-coder:7b' && (bv[0].bytes || 0) > 4e9, 'Offline, a model offers its tested tag only', bv);

  // ---------------------------------------------------------------------------
  section('7. The store: automatic, cached, verified');
  // ---------------------------------------------------------------------------
  const memory = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
  // A list page with enough models to count as a real one.
  const item = LIBRARY_HTML.match(/<li\s[\s\S]*?<\/li>/)![0];
  const bigList = Array.from({ length: MIN_LIBRARY_MODELS + 5 }, (_, i) => item.replace(/qwen3/g, `model${i}`)).join('\n');
  const calls = { library: 0, tags: 0, manifest: 0 };
  let libraryResponse: () => Promise<string> = async () => bigList;
  const manifests: Record<string, any> = {
    'qwen3:8b': { status: 'found', digest: '500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41', bytes: 5225376706 },
    'qwen3:99b': { status: 'missing' },
  };
  (globalThis as any).window = {
    electronAPI: {
      modelLibrary: async () => {
        calls.library++;
        return libraryResponse();
      },
      modelTags: async (name: string) => {
        calls.tags++;
        return name === 'qwen3' ? TAGS_HTML : '';
      },
      modelManifest: async (name: string, tag: string) => {
        calls.manifest++;
        return manifests[`${name}:${tag}`] || { status: 'error', error: 'HTTP 500' };
      },
    },
  };
  const store = useModelLibraryStore;
  await store.getState().ensureLibrary();
  check(store.getState().source === 'online' && store.getState().models.length === MIN_LIBRARY_MODELS + 5 && calls.library === 1, 'Opening the tab loads the list from ollama.com', store.getState().source);
  await store.getState().ensureLibrary();
  check(calls.library === 1, 'Within 12 hours the list is not requested again');
  store.setState({ models: [], fetchedAt: null });
  await store.getState().ensureLibrary();
  check(calls.library === 1 && store.getState().source === 'cache' && store.getState().models.length === MIN_LIBRARY_MODELS + 5, 'After a restart the saved copy is used (no request)');

  memory.clear();
  libraryResponse = async () => {
    throw new Error('getaddrinfo ENOTFOUND ollama.com');
  };
  await store.getState().ensureLibrary(true);
  check(store.getState().source === 'builtin' && store.getState().models.length === builtinLibrary().length && /ENOTFOUND/.test(store.getState().error || ''), 'Without a connection the built-in list is shown, with the reason');
  libraryResponse = async () => item;
  await store.getState().ensureLibrary(true);
  check(store.getState().source === 'builtin', 'A page that yields too few models (the site changed) is not trusted');

  await store.getState().ensureTags('qwen3');
  check(store.getState().tags.qwen3?.status === 'ready' && store.getState().tags.qwen3.variants.length === 9 && calls.tags === 1, 'Opening a model loads its tags from ollama.com');
  await store.getState().ensureTags('qwen3');
  check(calls.tags === 1, 'Tags are kept, not requested again');
  (globalThis as any).window.electronAPI.modelTags = async () => {
    throw new Error('offline');
  };
  await store.getState().ensureTags('qwen2.5-coder');
  check(
    store.getState().tags['qwen2.5-coder']?.builtin === true && store.getState().tags['qwen2.5-coder'].variants[0].tag === 'qwen2.5-coder:7b',
    'Offline, a model falls back to its tested default tag',
    store.getState().tags['qwen2.5-coder']
  );

  const verified = await store.getState().verifyTag('qwen3:8b');
  check(verified.status === 'verified' && verified.bytes === 5225376706 && calls.manifest === 1, 'A selected tag is verified in the registry with its exact size', verified);
  await store.getState().verifyTag('qwen3:8b');
  check(calls.manifest === 1, 'A fresh verification is reused');
  check((await store.getState().verifyTag('qwen3:99b')).status === 'missing', 'A tag the registry does not know is reported as missing');
  check((await store.getState().verifyTag('hf.co/someone/model:q4')).status === 'error', 'Sources the registry bridge cannot check are not requested');

  check((await store.getState().compareInstalled('qwen3:8b', '500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41')) === 'match', 'A downloaded model with the registry digest is verified as identical');
  check((await store.getState().compareInstalled('qwen3:8b', 'ffffffffffff0000')) === 'differs', 'A different digest means the registry has another version');
  await store.getState().checkInstalledModels([{ name: 'qwen3:8b', digest: '500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41' }, { name: 'hf.co/x/y:q4', digest: 'abc' }]);
  check(store.getState().installed['qwen3:8b'] === 'match' && !('hf.co/x/y:q4' in store.getState().installed), 'Installed models are checked one by one; foreign sources are skipped');

  console.log('\n===========================================');
  if (failures.length > 0) {
    console.error(`❌ ${failures.length} FAILED, ${passed} passed`);
    for (const f of failures) console.error(`   - ${f}`);
    process.exit(1);
  }
  console.log(`🎉 ALL ${passed} MODEL LIBRARY TESTS PASSED`);
  console.log('===========================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
