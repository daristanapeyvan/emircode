/**
 * check-model-library.ts — reads the live ollama.com pages and the registry the way the Models
 * window does, to notice early when ollama.com changes its markup. Needs an internet connection;
 * not part of `npm test`.
 *
 * Usage: npm run check:library
 */
import { createHash } from 'node:crypto';
import { CLOUD_GROUP, groupVariants, isLocal, modelsFor, parseLibraryHtml, parseTagsHtml, LIBRARY_CATEGORIES } from '../src/lib/ollama/library';

const UA = 'EmirCode-library-check (+https://github.com/daristanapeyvan/emircode)';
const problems: string[] = [];
const expect = (ok: boolean, message: string) => {
  console.log(`${ok ? '✅' : '❌'} ${message}`);
  if (!ok) problems.push(message);
};

async function text(url: string, accept = 'text/html'): Promise<{ status: number; body: string; raw: Buffer }> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept } });
  const raw = Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: raw.toString('utf8'), raw };
}

async function main() {
  const list = await text('https://ollama.com/library?sort=popular');
  const models = parseLibraryHtml(list.body);
  expect(list.status === 200 && models.length >= 100, `library page: ${models.length} models (${models.filter(isLocal).length} local)`);
  for (const c of LIBRARY_CATEGORIES) {
    const n = modelsFor(models, c.id).length;
    expect(n > 0, `category ${c.id}: ${n}`);
  }
  const withSizes = models.filter((m) => m.sizes.length > 0).length;
  expect(withSizes >= models.length * 0.6, `models with size labels: ${withSizes}`);
  expect(models.filter((m) => m.pulls > 0).length >= models.length * 0.8, 'pull counts are read');

  for (const name of ['qwen3', 'qwen2.5-coder', 'nomic-embed-text']) {
    const page = await text(`https://ollama.com/library/${name}/tags`);
    const variants = parseTagsHtml(name, page.body);
    const groups = groupVariants(name, variants);
    const complete = variants.filter((v) => v.digest && v.bytes).length;
    expect(page.status === 200 && variants.length > 0 && complete === variants.length, `${name}: ${variants.length} tags, ${groups.length} sizes, all with digest and size`);
    const def = groups.flatMap((g) => g.options).find((o) => o.isDefault);
    if (def) {
      const [model, tag] = def.variant.tag.split(':');
      const manifest = await text(`https://registry.ollama.ai/v2/library/${model}/manifests/${tag}`, 'application/vnd.docker.distribution.manifest.v2+json');
      const digest = createHash('sha256').update(manifest.raw).digest('hex');
      expect(manifest.status === 200 && digest.startsWith(def.variant.digest), `${def.variant.tag}: registry digest ${digest.slice(0, 12)} = listed ${def.variant.digest}`);
    }
  }
  // Cloud tags (run on ollama.com): no download size, a group of their own after the local sizes.
  // test_fixtures/ollama/tags_gpt-oss.html is a sample of this page.
  const cloudPage = await text('https://ollama.com/library/gpt-oss/tags');
  const cloudVariants = parseTagsHtml('gpt-oss', cloudPage.body);
  const cloudTags = cloudVariants.filter((v) => v.group === CLOUD_GROUP);
  const cloudGroups = groupVariants('gpt-oss', cloudVariants);
  expect(
    cloudPage.status === 200 && cloudTags.length > 0 && cloudTags.every((v) => !v.bytes) && cloudGroups[cloudGroups.length - 1]?.size === CLOUD_GROUP,
    `gpt-oss: ${cloudTags.length} cloud tags (${cloudTags.map((v) => v.name).join(', ')}), no download size, grouped last`
  );
  const cloudModels = modelsFor(models, 'cloud');
  expect(cloudModels.length > 0 && cloudModels.every((m) => m.cloud), `cloud category: ${cloudModels.length} models`);

  const missing = await text('https://registry.ollama.ai/v2/library/qwen3/manifests/no-such-tag', 'application/vnd.docker.distribution.manifest.v2+json');
  expect(missing.status === 404, 'an unknown tag is a 404 in the registry');

  console.log(problems.length ? `\n${problems.length} problem(s): ollama.com may have changed.` : '\nThe live pages parse as expected.');
  process.exit(problems.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
