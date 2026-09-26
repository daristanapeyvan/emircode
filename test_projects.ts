/**
 * test_projects.ts
 * The sidebar's project view and the New Project flow: folder keys, name rules, grouping tasks
 * by folder, short ages, and the agent store's project actions (a task in a folder, a new
 * project, the pending project of a wizard, leaving a running task).
 *
 * Run: node scripts/run-ts-test.mjs test_projects.ts
 */
import {
  projectKey,
  folderNameOf,
  joinPath,
  compactPath,
  checkProjectName,
  groupTasksByProject,
  formatAge,
  describeProjectError,
} from './src/lib/utils/projects';
import { getTranslations } from './src/lib/localization/i18n';
import type { Chat } from './src/types/chat';

let passed = 0;
const failures: string[] = [];
function check(condition: boolean, message: string, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`✅ ${message}`);
  } else {
    failures.push(message);
    console.error(`❌ ${message}${detail !== undefined ? `\n   → ${JSON.stringify(detail).slice(0, 900)}` : ''}`);
  }
}
const section = (title: string) => console.log(`\n--- ${title} ---`);

const task = (id: string, root: string | undefined, updatedAt: number, extra: Partial<Chat> = {}): Chat => ({
  id,
  title: id,
  model: 'm',
  mode: 'agent',
  workspaceRoot: root,
  workspaceName: root ? folderNameOf(root) : undefined,
  createdAt: updatedAt,
  updatedAt,
  ...extra,
});

section('Folder keys and paths');
check(projectKey('C:\\Projeler\\Kafe') === projectKey('c:/projeler/kafe/'), 'Windows paths match regardless of case, slash and trailing separator');
check(projectKey('C:\\') === 'c:\\' && projectKey('C:') === 'c:\\', 'A drive root keeps its separator');
check(projectKey('/home/emir/Kafe') !== projectKey('/home/emir/kafe'), 'POSIX paths stay case-sensitive');
check(projectKey('/home/emir/kafe/') === '/home/emir/kafe', 'POSIX trailing slash is ignored');
check(projectKey('\\\\server\\share\\Proje') === projectKey('\\\\SERVER\\share\\proje'), 'UNC paths compare case-insensitively');
check(folderNameOf('C:\\Users\\a\\Belgeler\\kafe-sitesi\\') === 'kafe-sitesi', 'folderNameOf: last part of a Windows path');
check(folderNameOf('/home/a/site') === 'site', 'folderNameOf: last part of a POSIX path');
check(joinPath('C:\\Users\\a\\Documents\\', 'kafe') === 'C:\\Users\\a\\Documents\\kafe', 'joinPath keeps Windows separators');
check(joinPath('/home/a', 'kafe') === '/home/a/kafe', 'joinPath keeps POSIX separators');
check(compactPath('C:\\Users\\a\\Belgeler\\Emir Code Projeleri\\kafe', 2) === '…\\Emir Code Projeleri\\kafe', 'compactPath keeps the end of a long Windows path');
check(compactPath('/home/a/kafe', 3) === '/home/a/kafe' && compactPath('/a/b/c/d/e', 2) === '…/d/e', 'compactPath leaves short paths alone and keeps POSIX separators');

section('Project names');
check(checkProjectName('kafe-sitesi') === null, 'A plain name is accepted');
check(checkProjectName('Kafe Sitesi 2') === null, 'Spaces and digits are accepted');
check(checkProjectName('Çiçekçi Şükrü') === null, 'Non-ASCII letters are accepted');
check(checkProjectName('   ') === 'empty', 'Blank name: empty');
check(checkProjectName('a/b') === 'invalid' && checkProjectName('a\\b') === 'invalid', 'Slashes are refused');
check(['a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b'].every((n) => checkProjectName(n) === 'invalid'), 'Characters Windows forbids are refused');
check(checkProjectName('site.') === 'invalid' && checkProjectName('..') === 'invalid', 'Trailing dot and ".." are refused');
check(checkProjectName('CON') === 'reserved' && checkProjectName('com1.txt') === 'reserved' && checkProjectName('lpt9') === 'reserved', 'Windows device names are refused');
check(checkProjectName('console') === null, 'A name that only starts like a device name is fine');
check(checkProjectName('x'.repeat(81)) === 'tooLong' && checkProjectName('x'.repeat(80)) === null, 'At most 80 characters');

const tr = getTranslations('tr').projects;
const en = getTranslations('en').projects;
check(describeProjectError(tr, 'exists') === tr.errorExists, 'describeProjectError: exists');
check(describeProjectError(en, 'invalid-name') === en.errorInvalid, 'describeProjectError: the main process code maps to the same text');
check(describeProjectError(en, 'error', 'EACCES').includes('EACCES'), 'describeProjectError: the system error is shown');
check(Object.keys(tr).length === Object.keys(en).length, 'Turkish and English project texts have the same keys');

section('Grouping tasks by folder');
const now = Date.UTC(2026, 8, 26, 12, 0, 0);
const chats: Chat[] = [
  task('kafe-1', 'C:\\Projeler\\kafe', now - 60_000),
  task('lama-1', 'C:\\Projeler\\lama', now - 30_000),
  task('kafe-2', 'c:/projeler/Kafe/', now - 5_000, { workspaceName: 'Kafe' }),
  task('eski', undefined, now - 86_400_000 * 40),
  { id: 'sohbet', title: 'sohbet', model: 'm', mode: 'chat', createdAt: now, updatedAt: now },
  task('lama-0', 'C:\\Projeler\\lama', now - 3_600_000),
];
const groups = groupTasksByProject(chats, undefined, now);
check(groups.length === 3, 'Two folders and one "no folder" group', groups.map((g) => g.name));
check(groups[0].key === projectKey('C:\\Projeler\\kafe') && groups[0].chats.map((c) => c.id).join() === 'kafe-2,kafe-1', 'The same folder written differently is one group, newest task first');
check(groups[0].name === 'Kafe' && groups[0].root === 'c:/projeler/Kafe/', 'The newest task decides the group name and path');
check(groups[1].chats.map((c) => c.id).join() === 'lama-1,lama-0', 'Second group: lama, newest first');
check(groups[2].key === '' && groups[2].root === null && groups[2].chats[0].id === 'eski', 'Tasks without a folder come last');
check(!groups.some((g) => g.chats.some((c) => c.id === 'sohbet')), 'Chat conversations are not listed as tasks');

const withOpen = groupTasksByProject(chats, { root: 'D:\\yeni-proje', name: 'yeni-proje' }, now);
check(withOpen[0].name === 'yeni-proje' && withOpen[0].chats.length === 0, 'The open folder shows up (first) before its first task');
const openExisting = groupTasksByProject(chats, { root: 'C:\\PROJELER\\LAMA', name: 'LAMA' }, now);
check(openExisting.length === 3 && openExisting[1].name === 'lama', 'An open folder that already has tasks is not listed twice');
check(groupTasksByProject([], undefined, now).length === 0, 'No tasks and no folder: nothing');

section('Ages');
const labels = { now: tr.ageNow, minutes: tr.ageMinutes, hours: tr.ageHours, days: tr.ageDays };
check(formatAge(now - 20_000, labels, 'tr', now) === 'şimdi', 'Under a minute: now');
check(formatAge(now - 5 * 60_000, labels, 'tr', now) === '5 dk', 'Minutes');
check(formatAge(now - 3 * 3_600_000, labels, 'tr', now) === '3 sa', 'Hours');
check(formatAge(now - 2 * 86_400_000, labels, 'tr', now) === '2 g', 'Days');
const old = formatAge(now - 30 * 86_400_000, labels, 'en', now);
check(/Aug|27/.test(old) && !/2026/.test(old), 'Older: a short date without the year', old);
check(/2025/.test(formatAge(Date.UTC(2025, 0, 5), labels, 'en', now)), 'Another year: the year is shown');

section('Agent store: projects');
const folders = new Set<string>(['C:\\Projeler\\kafe', 'C:\\Projeler\\lama']);
const calls: string[] = [];
let confirmAnswer = true;
const alerts: string[] = [];
(globalThis as any).window = {
  confirm: (msg: string) => {
    calls.push(`confirm:${msg}`);
    return confirmAnswer;
  },
  alert: (msg: string) => alerts.push(msg),
  electronAPI: {
    loadStorage: async () => null,
    saveStorage: async () => true,
    setWorkspacePath: async (p: string) => {
      calls.push(`setPath:${p}`);
      return folders.has(p) ? { success: true, rootPath: p, folderName: folderNameOf(p) } : { success: false, error: 'Klasör bulunamadı.' };
    },
    listWorkspaceFiles: async () => ({ success: true, files: [] }),
    createProject: async (parent: string, name: string) => {
      calls.push(`create:${parent}|${name}`);
      if (name === 'dolu') return { success: false, code: 'exists' };
      const root = joinPath(parent, name);
      folders.add(root);
      return { success: true, rootPath: root, folderName: name };
    },
    openWorkspaceDialog: async () => ({ success: true, rootPath: 'C:\\Projeler\\lama', folderName: 'lama' }),
  },
};

async function storeTests() {
  const { useAgentStore } = await import('./src/stores/agentStore');
  const { useChatStore } = await import('./src/stores/chatStore');
  const { storageService } = await import('./src/lib/storage/StorageService');
  await storageService.init();

  // A saved task in "kafe" with an applied change, open in the agent view
  await useAgentStore.getState().startTaskInFolder('C:\\Projeler\\kafe');
  check(useAgentStore.getState().workspaceRoot === 'C:\\Projeler\\kafe', 'startTaskInFolder opens the folder');
  check(storageService.getLastWorkspace().rootPath === 'C:\\Projeler\\kafe', 'The folder is remembered for the next start');

  const id = useChatStore.getState().createNewChat('m', 'agent', 'Menü ekle');
  useAgentStore.setState({
    sessionChatId: id,
    currentGoal: 'Menü ekle',
    steps: [{ id: 's1', timestamp: now, type: 'system_notice', content: 'x', status: 'success' }],
    appliedTransactions: [{ transactionId: 'tx1', relativePath: 'index.html' } as any],
  });
  // The user opens a conversation in the Chat mode: the task is still saved to its own chat.
  useChatStore.getState().createNewChat('m', 'chat');
  useAgentStore.getState().persistCurrentSession();
  const saved = storageService.getChat(id);
  check(saved?.workspaceRoot === 'C:\\Projeler\\kafe' && saved?.agentGoal === 'Menü ekle', 'persistCurrentSession saves to the session task, not the selected chat');
  const listed = useChatStore.getState().chats.find((c) => c.id === id);
  check(listed?.workspaceRoot === 'C:\\Projeler\\kafe', 'The sidebar list gets the folder of the task right away');
  check(groupTasksByProject(useChatStore.getState().chats)[0].chats[0].id === id, 'The new task appears under its folder');

  // "+" of the same folder: an empty session, the old changes are not undoable from it
  calls.length = 0;
  await useAgentStore.getState().startTaskInFolder('c:/projeler/KAFE');
  let s = useAgentStore.getState();
  check(s.sessionChatId === null && s.steps.length === 0 && s.appliedTransactions.length === 0, 'A new task starts empty (no rollback of the previous task)');
  check(!calls.some((c) => c.startsWith('setPath')), 'The same folder (written differently) is not reopened');

  // "+" of another folder
  await useAgentStore.getState().startTaskInFolder('C:\\Projeler\\lama');
  check(useAgentStore.getState().workspaceRoot === 'C:\\Projeler\\lama', 'Another project folder is opened');

  // A folder that was deleted
  alerts.length = 0;
  const ok = await useAgentStore.getState().startTaskInFolder('C:\\Projeler\\silindi');
  check(!ok && alerts.length === 1 && useAgentStore.getState().workspaceRoot === 'C:\\Projeler\\lama', 'A missing folder: a message, nothing changes');

  // Leaving a running task
  useAgentStore.setState({ agentStatus: 'thinking', sessionChatId: id, steps: [{ id: 's2', timestamp: now, type: 'thought', content: 'y', status: 'success' } as any] });
  confirmAnswer = false;
  const stayed = await useAgentStore.getState().startTaskInFolder('C:\\Projeler\\kafe');
  s = useAgentStore.getState();
  check(!stayed && s.agentStatus === 'thinking' && s.sessionChatId === id, 'Refusing to stop keeps the running task');
  confirmAnswer = true;
  const moved = await useAgentStore.getState().startTaskInFolder('C:\\Projeler\\kafe');
  s = useAgentStore.getState();
  check(moved && s.agentStatus === 'idle' && s.sessionChatId === null && s.workspaceRoot === 'C:\\Projeler\\kafe', 'Agreeing stops it and opens the other folder');
  check(storageService.getChat(id)?.agentSteps?.some((st) => st.id === 's2') === true, 'The stopped task was saved before leaving');

  // An approval of a stopped run is answered "no" and its modal disappears
  let answered: boolean | null = null;
  useAgentStore.getState().setPendingCommand({ id: 'c', binary: 'npm', args: ['test'] } as any, (v) => (answered = v));
  useAgentStore.getState().clearSession();
  check(answered === false && useAgentStore.getState().pendingCommand === null, 'Leaving answers a waiting approval with "no"');

  // New Project (empty)
  const created = await useAgentStore.getState().createProject('C:\\Belgeler\\Emir Code Projeleri', 'kafe-sitesi');
  check(created.success && useAgentStore.getState().workspaceRoot === 'C:\\Belgeler\\Emir Code Projeleri\\kafe-sitesi', 'createProject opens the new folder');
  const failed = await useAgentStore.getState().createProject('C:\\Belgeler', 'dolu');
  check(!failed.success && failed.code === 'exists', 'createProject reports why it failed');

  // New Project with a wizard: the folder is made on the wizard's confirm
  calls.length = 0;
  useAgentStore.getState().setPendingProject({ parentDir: 'C:\\Belgeler', name: 'site', target: 'C:\\Belgeler\\site' });
  check(!calls.some((c) => c.startsWith('create')), 'Choosing a wizard does not create the folder yet');
  check(await useAgentStore.getState().createPendingProject(), 'createPendingProject succeeds');
  s = useAgentStore.getState();
  check(s.pendingProject === null && s.workspaceRoot === 'C:\\Belgeler\\site', 'The pending project becomes the open folder');
  alerts.length = 0;
  useAgentStore.getState().setPendingProject({ parentDir: 'C:\\Belgeler', name: 'dolu', target: 'C:\\Belgeler\\dolu' });
  check(!(await useAgentStore.getState().createPendingProject()) && alerts.length === 1 && useAgentStore.getState().pendingProject !== null, 'A failed pending project shows why and stays pending');
  useAgentStore.getState().setPendingProject(null);
  check(await useAgentStore.getState().createPendingProject(), 'createPendingProject without a pending project is a no-op');

  // Open an existing folder
  check((await useAgentStore.getState().openExistingProject()) && useAgentStore.getState().workspaceRoot === 'C:\\Projeler\\lama', 'openExistingProject opens the chosen folder');
}

storeTests()
  .catch((err) => {
    failures.push(`store tests crashed: ${err?.stack || err}`);
    console.error(err);
  })
  .finally(() => {
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length > 0) {
      console.error(failures.map((f) => ` - ${f}`).join('\n'));
      process.exitCode = 1;
    }
  });
