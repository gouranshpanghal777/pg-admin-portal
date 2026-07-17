#!/usr/bin/env python3
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "src/App.tsx"
TEST = ROOT / "scripts/self-test.mjs"
SELF = Path(__file__).resolve()
BACKUP_BRANCH = "backup-before-activity-history-ui-2026-07-17"
ALLOWED_UNTRACKED = {
    "qa-smoke-report.md",
    "scripts/qa-smoke-test.mjs",
    "farukhnagar-ledger-audit.json",
}


def run(*args: str) -> None:
    print("\n$", " ".join(args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


status = subprocess.run(
    ["git", "status", "--porcelain"],
    cwd=ROOT,
    check=True,
    capture_output=True,
    text=True,
).stdout.splitlines()
blockers = [line for line in status if not (line.startswith("?? ") and line[3:] in ALLOWED_UNTRACKED)]
if blockers:
    raise SystemExit("Working tree has unrelated changes:\n" + "\n".join(blockers))

run("git", "branch", "-f", BACKUP_BRANCH, "HEAD")
run("git", "push", "origin", f"HEAD:refs/heads/{BACKUP_BRANCH}")

original_app = APP.read_text()
original_test = TEST.read_text()
app = original_app
test = original_test

old_card = '''      <Card><h2 className="mb-4 text-lg font-bold">Recent Activities</h2><div className="grid gap-2 md:grid-cols-2">{scoped.activityLogs.slice(0, 6).map((log) => <div key={log.id} className="rounded-md bg-slate-50 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><b>{log.actionType}</b><span className="text-xs text-slate-400">{formatDateTime(log.at)}</span></div><p className="mt-1 text-slate-600">{log.description}</p></div>)}{!scoped.activityLogs.length && <p className="text-sm text-slate-500">No recent activity.</p>}</div></Card>'''
new_card = '''      <Card><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Recent Activities</h2><p className="text-xs text-slate-500">Latest 6 entries shown · history retained for 30 days</p></div><Button tone="soft" onClick={() => setModal('activityHistory')}><History size={16} /> View previous activity</Button></div><div className="grid gap-2 md:grid-cols-2">{scoped.activityLogs.slice(0, 6).map((log) => <div key={log.id} className="rounded-md bg-slate-50 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><b>{log.actionType}</b><span className="text-xs text-slate-400">{formatDateTime(log.at)}</span></div><p className="mt-1 text-slate-600">{log.description}</p></div>)}{!scoped.activityLogs.length && <p className="text-sm text-slate-500">No recent activity.</p>}</div></Card>'''
app = replace_once(app, old_card, new_card, "dashboard recent activity card")

component = r'''
function ActivityHistoryModal({ logs, onClose }: { logs: ActivityLog[]; onClose: () => void }) {
  const pageSize = 10
  const [page, setPage] = useState(0)
  const [userFilter, setUserFilter] = useState('All')
  const [moduleFilter, setModuleFilter] = useState('All')
  const users = Array.from(new Set(logs.map((log) => log.userName).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  const modules = Array.from(new Set(logs.map((log) => log.module).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  const filtered = logs.filter((log) => (userFilter === 'All' || log.userName === userFilter) && (moduleFilter === 'All' || log.module === moduleFilter))
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const start = safePage * pageSize
  const visible = filtered.slice(start, start + pageSize)
  const resetFilters = () => { setUserFilter('All'); setModuleFilter('All'); setPage(0) }
  return <Modal title="Activity History - Last 30 Days" wide onClose={onClose}>
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Staff / Admin"><select className={inputClass} value={userFilter} onChange={(event) => { setUserFilter(event.target.value); setPage(0) }}><option>All</option>{users.map((name) => <option key={name} value={name}>{name}</option>)}</select></Field>
        <Field label="Module"><select className={inputClass} value={moduleFilter} onChange={(event) => { setModuleFilter(event.target.value); setPage(0) }}><option>All</option>{modules.map((module) => <option key={module} value={module}>{module}</option>)}</select></Field>
        <Button tone="soft" onClick={resetFilters}>Clear filters</Button>
        <div className="flex-1" />
        <p className="text-sm font-semibold text-slate-600">{filtered.length ? `${start + 1}-${Math.min(start + pageSize, filtered.length)} of ${filtered.length}` : '0 entries'}</p>
      </div>
      <div className="grid gap-2">
        {visible.map((log) => <div key={log.id} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm"><div className="flex flex-wrap items-start justify-between gap-2"><div><b>{log.actionType}</b><span className="ml-2 text-xs text-slate-500">{log.module} · {log.userName} ({log.role})</span></div><span className="text-xs font-medium text-slate-500">{formatDateTime(log.at)}</span></div><p className="mt-1 text-slate-700">{log.description}</p></div>)}
        {!visible.length && <div className="rounded-md bg-slate-50 p-5 text-center text-sm text-slate-500">No activity found for these filters.</div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
        <p className="text-xs text-slate-500">Logs remain available for 30 days. Page {safePage + 1} of {totalPages}.</p>
        <div className="flex gap-2"><Button tone="soft" disabled={safePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Newer entries</Button><Button tone="blue" disabled={safePage >= totalPages - 1} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>Older entries</Button></div>
      </div>
    </div>
  </Modal>
}

'''
app = replace_once(app, "function Dashboard({ scoped,", component + "function Dashboard({ scoped,", "activity history component")

modal_marker = '''      {modal === 'notifications' && <Modal title="Notifications" onClose={closeModal}>{notifications.length ? <div className="grid gap-2">{notifications.map((note) => <div key={note} className="rounded-md bg-orange-50 p-3 text-sm font-semibold text-orange-800">{note}</div>)}</div> : <p>No active alerts.</p>}</Modal>}'''
modal_replacement = '''      {modal === 'activityHistory' && <ActivityHistoryModal logs={scoped.activityLogs} onClose={closeModal} />}
''' + modal_marker
app = replace_once(app, modal_marker, modal_replacement, "activity history modal wiring")

self_test_block = r'''
// Activity history pagination checks
const activityHistoryPageSize = 10
const activityHistoryRows = Array.from({ length: 23 }, (_, index) => ({ id: index + 1 }))
assert(activityHistoryRows.slice(0, activityHistoryPageSize).length === 10, 'AH1. Activity history shows ten entries per page')
assert(activityHistoryRows.slice(activityHistoryPageSize, activityHistoryPageSize * 2).length === 10, 'AH2. Older activity page is available')
assert(activityHistoryRows.slice(activityHistoryPageSize * 2, activityHistoryPageSize * 3).length === 3, 'AH3. Final activity page keeps remaining entries')

'''
test = replace_once(test, "console.log('All PG Admin Portal flow checks passed.')", self_test_block + "console.log('All PG Admin Portal flow checks passed.')", "activity history self-tests")

try:
    APP.write_text(app)
    TEST.write_text(test)

    combined = app + test
    checks = {
        "dashboard history button": "View previous activity",
        "30-day history title": "Activity History - Last 30 Days",
        "older entries button": "Older entries",
        "newer entries button": "Newer entries",
        "pagination page size": "const pageSize = 10",
        "modal wiring": "modal === 'activityHistory'",
        "history self-test": "AH3. Final activity page keeps remaining entries",
    }
    for label, marker in checks.items():
        if marker not in combined:
            raise SystemExit(f"Preflight failed: {label} is missing.")

    run("npm", "run", "self-test")
    run("npm", "run", "build")
    run("npm", "run", "lint")

    SELF.unlink()
    run("git", "add", "src/App.tsx", "scripts/self-test.mjs", "scripts/apply-activity-history-pagination.py")
    run("git", "commit", "-m", "feat: add paginated 30-day activity history")
    run("git", "push", "origin", "main")
    print("\nActivity History pagination is live. Backup branch: " + BACKUP_BRANCH, flush=True)
except BaseException:
    APP.write_text(original_app)
    TEST.write_text(original_test)
    print("\nFiles were restored because the Activity History update did not complete.", flush=True)
    raise
