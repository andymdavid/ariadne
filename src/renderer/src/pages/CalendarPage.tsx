import { MainContentPanel } from '../components/MainContentPanel'

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const weeks = [
  ['Mar 1', 'Mar 2', 'Mar 3', 'Mar 4', 'Mar 5', 'Mar 6', 'Mar 7'],
  ['Mar 8', 'Mar 9', 'Mar 10', 'Mar 11', 'Mar 12', 'Mar 13', 'Mar 14'],
  ['Mar 15', 'Mar 16', 'Mar 17', 'Mar 18', 'Mar 19', 'Mar 20', 'Mar 21'],
  ['Mar 22', 'Mar 23', 'Mar 24', 'Mar 25', 'Mar 26', 'Mar 27', 'Mar 28'],
  ['Mar 29', 'Mar 30', 'Mar 31', 'Apr 1', 'Apr 2', 'Apr 3', 'Apr 4']
]

export function CalendarPage() {
  return (
    <MainContentPanel>
      <div className="app-page">
        <div className="mx-auto flex h-full max-w-6xl flex-col gap-6">
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-3xl">
              <div className="app-page-title">Calendar</div>
              <div className="app-page-subtitle">Schedule and review upcoming posts.</div>
            </div>
            <div className="flex items-center gap-3">
              <button className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black">Schedule post</button>
              <button className="rounded-xl border border-border-default bg-bg-secondary px-4 py-2 text-sm text-text-primary">Upload local video</button>
            </div>
          </div>

          <div className="rounded-2xl border border-border-default bg-bg-secondary/50 overflow-hidden">
            <div className="grid grid-cols-7 border-b border-border-default">
              {days.map((day) => (
                <div key={day} className="px-4 py-3 text-sm font-medium text-text-secondary">
                  {day}
                </div>
              ))}
            </div>

            <div>
              {weeks.map((week, weekIndex) => (
                <div key={weekIndex} className="grid grid-cols-7 border-b border-border-default last:border-b-0">
                  {week.map((day) => (
                    <div key={day} className="min-h-[120px] border-r border-border-default last:border-r-0 px-4 py-3 text-sm text-text-muted">
                      {day}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </MainContentPanel>
  )
}
