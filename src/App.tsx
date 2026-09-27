import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowDownUp, ArrowLeft, ArrowRight, Bell, BellOff, CalendarDays, Check,
  CheckCircle2, ChevronDown, Circle, Clock3, Download, ExternalLink, Filter,
  Heart, KeyRound, LayoutList, Link as LinkIcon, LoaderCircle, LogOut, Mail, Pencil, Plus, Search,
  ShieldCheck, Sparkles, Target, Trash2, Upload, X,
} from 'lucide-react'
import { supabase, supabaseConfigured, supabaseConfigError } from './supabase'
import { getAuthCallbackError, getAuthRedirectUrl } from './authUtils'
import {
  groupTasks, isSafeTaskLink, mapDatabaseTask, nextOccurrence, parseTaskBackup,
  sortTasks, starterTasks, STORAGE_KEY, toDatabaseTask,
} from './taskUtils'
import type { RepeatRule, Task, TaskDraft, TaskPriority, TaskStatus } from './taskUtils'

type View = 'list' | 'calendar'
type Sort = 'due' | 'priority' | 'newest'
type FilterStatus = 'all' | TaskStatus
type DueFilter = 'all' | 'overdue' | 'today' | 'upcoming'
type AuthMode = 'signin' | 'signup' | 'reset' | 'recovery'

const blankDraft: TaskDraft = {
  title: '', subject: '', due: '', description: '', link: '',
  status: 'todo', priority: 'medium', repeat: 'none', repeatDay: null, remind: false,
}
const groupLabels = { overdue: 'Прострочені', today: 'Сьогодні', week: 'Цього тижня', later: 'Пізніше' }
const statusLabels: Record<TaskStatus, string> = { todo: 'Не розпочато', progress: 'В процесі', done: 'Виконано' }
const priorityLabels: Record<TaskPriority, string> = { high: 'Високий', medium: 'Середній', low: 'Низький' }
const repeatLabels: Record<RepeatRule, string> = { none: 'Не повторювати', daily: 'Щодня', weekly: 'Щотижня', monthly: 'Щомісяця' }

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function readLocalTasks(): { tasks: Task[]; error: string } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return { tasks: starterTasks, error: '' }
    return { tasks: parseTaskBackup(saved), error: '' }
  } catch (storageError) {
    return { tasks: [], error: `Не вдалося прочитати локальні дані: ${(storageError as Error).message}` }
  }
}

function App() {
  const [localMode, setLocalMode] = useState(() => !supabaseConfigured || sessionStorage.getItem('deadline-radar-local-mode') === 'true')
  const [initialLocalData] = useState(() => localMode ? readLocalTasks() : { tasks: [], error: '' })
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabaseConfigured || sessionStorage.getItem('deadline-radar-local-mode') === 'true')
  const [loadedUserId, setLoadedUserId] = useState('')
  const loadedUserRef = useRef('')
  const [tasks, setTasks] = useState<Task[]>(initialLocalData.tasks)
  const [query, setQuery] = useState('')
  const [subject, setSubject] = useState('all')
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')
  const [dueFilter, setDueFilter] = useState<DueFilter>('all')
  const [sort, setSort] = useState<Sort>('due')
  const [view, setView] = useState<View>('list')
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()))
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [draft, setDraft] = useState<TaskDraft>(blankDraft)
  const [error, setError] = useState(initialLocalData.error)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authMode, setAuthMode] = useState<AuthMode>('signin')
  const [confirmationPending, setConfirmationPending] = useState(false)
  const [showDeleteAccount, setShowDeleteAccount] = useState(false)
  const [accountConfirmation, setAccountConfirmation] = useState('')
  const [remindersEnabled, setRemindersEnabled] = useState(() => localStorage.getItem('deadline-radar-reminders') === 'true')
  const [permission, setPermission] = useState<NotificationPermission>(() => 'Notification' in window ? Notification.permission : 'denied')
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!supabase || localMode) return
    let active = true
    setTasks([])
    const authErrorFromCallback = getAuthCallbackError(window.location.search, window.location.hash)
    if (authErrorFromCallback) setError(`Вхід не завершився: ${authErrorFromCallback.replace(/\+/g, ' ')}`)
    supabase.auth.getSession().then(({ data, error: authError }) => {
      if (!active) return
      if (authError) setError(`Не вдалося перевірити сесію: ${authError.message}`)
      setSession(data.session)
      setAuthReady(true)
    }).catch((authError: Error) => {
      if (active) {
        setError(`Не вдалося підключитися до Supabase: ${authError.message}`)
        setAuthReady(true)
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (active) {
        setSession(nextSession)
        if (event === 'PASSWORD_RECOVERY') {
          setAuthPassword('')
          if (nextSession?.user.email) setAuthEmail(nextSession.user.email)
          setAuthMode('recovery')
        } else if (event === 'SIGNED_IN') setAuthMode('signin')
        else if (event === 'SIGNED_OUT') {
          setTasks([])
          loadedUserRef.current = ''
          setLoadedUserId('')
        }
        if (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') setError('')
      }
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [localMode])

  useEffect(() => {
    if (!supabase || localMode || !session?.user.id) return
    let active = true
    setError('')
    const client = supabase
    const reloadTasks = async () => {
      if (loadedUserRef.current !== session.user.id) setBusy(true)
      try {
        const { data, error: loadError } = await client.from('tasks').select('*').order('due_at', { ascending: true })
        if (!active) return
        if (loadError) setError(`Не вдалося завантажити завдання із Supabase: ${loadError.message}`)
        else {
          setError('')
          setTasks((data ?? []).map((row) => mapDatabaseTask(row as Record<string, unknown>)))
        }
      } catch (loadError) {
        if (active) setError(`Не вдалося підключитися до Supabase: ${(loadError as Error).message}`)
      } finally {
        if (active) {
          loadedUserRef.current = session.user.id
          setLoadedUserId(session.user.id)
          setBusy(false)
        }
      }
    }
    void reloadTasks()
    const reloadWhenVisible = () => {
      if (document.visibilityState === 'visible') void reloadTasks()
    }
    document.addEventListener('visibilitychange', reloadWhenVisible)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', reloadWhenVisible)
    }
  }, [localMode, session?.user.id])

  useEffect(() => {
    if (!localMode) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
    } catch (storageError) {
      setError(`Не вдалося зберегти дані у браузері: ${(storageError as Error).message}`)
    }
  }, [localMode, tasks])

  const subjects = useMemo(() => [...new Set(tasks.map((task) => task.subject))].sort((a, b) => a.localeCompare(b, 'uk')), [tasks])
  const filteredTasks = useMemo(() => {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const end = new Date(start)
    end.setDate(end.getDate() + (dueFilter === 'today' ? 1 : 7))
    return sortTasks(tasks.filter((task) => {
      const due = new Date(task.due)
      return (subject === 'all' || task.subject === subject) &&
        (statusFilter === 'all' || task.status === statusFilter) &&
        (dueFilter === 'all' || (dueFilter === 'overdue' ? task.status !== 'done' && due < start : due >= start && due < end && task.status !== 'done')) &&
        `${task.title} ${task.subject} ${task.description}`.toLocaleLowerCase('uk').includes(query.toLocaleLowerCase('uk'))
    }), sort)
  }, [tasks, subject, statusFilter, dueFilter, query, sort, now])
  const groups = useMemo(() => groupTasks(filteredTasks), [filteredTasks])
  const overdueCount = tasks.filter((task) => task.status !== 'done' && new Date(task.due) < new Date(now.getFullYear(), now.getMonth(), now.getDate())).length
  const doneCount = tasks.filter((task) => task.status === 'done').length
  const todayCount = tasks.filter((task) => {
    const due = new Date(task.due)
    return task.status !== 'done' && due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth() && due.getDate() === now.getDate()
  }).length
  const upcomingEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  upcomingEnd.setDate(upcomingEnd.getDate() + 7)
  const upcomingCount = tasks.filter((task) => task.status !== 'done' && new Date(task.due) >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) && new Date(task.due) < upcomingEnd).length

  const persist = useCallback(async (changed: Task[], deletedId?: string) => {
    try {
      if (!localMode && supabase) {
        const result = deletedId
          ? await supabase.from('tasks').delete().eq('id', deletedId)
          : await supabase.from('tasks').upsert(changed.map((task) => ({ id: task.id, ...toDatabaseTask(task) })))
        if (result.error) {
          setError(`Не вдалося синхронізувати зміни. Перевірте з’єднання та повторіть дію: ${result.error.message}`)
          return false
        }
      }
    } catch (syncError) {
      setError(`Не вдалося синхронізувати зміни. Перевірте з’єднання та повторіть дію: ${(syncError as Error).message}`)
      return false
    }
    setError('')
    setTasks((current) => deletedId ? current.filter((task) => task.id !== deletedId) : mergeTasks(current, changed))
    return true
  }, [localMode])

  function authRedirectUrl() {
    return getAuthRedirectUrl(import.meta.env.BASE_URL, window.location.origin)
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    setNotice('')
    setConfirmationPending(false)
    try {
      const result = authMode === 'signin'
        ? await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
        : await supabase.auth.signUp({ email: authEmail, password: authPassword, options: { emailRedirectTo: authRedirectUrl() } })
      if (result.error) setError(`Помилка входу: ${result.error.message}`)
      else if (authMode === 'signup' && !result.data.session) {
        setNotice('Майже готово! Перевірте пошту й натисніть посилання підтвердження, щоб активувати акаунт.')
        setConfirmationPending(true)
      }
    } catch (authError) {
      setError(`Не вдалося зв’язатися із Supabase: ${(authError as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function signInWithGoogle() {
    if (!supabase) return
    setBusy(true)
    setError('')
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: authRedirectUrl() },
      })
      if (oauthError) setError(`Не вдалося увійти через Google: ${oauthError.message}`)
    } catch (oauthError) {
      setError(`Не вдалося відкрити вхід Google: ${(oauthError as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function sendPasswordReset(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(authEmail, {
        redirectTo: authRedirectUrl(),
      })
      if (resetError) setError(`Не вдалося надіслати лист: ${resetError.message}`)
      else setNotice('Якщо для цієї адреси є акаунт, надішлемо лист із посиланням для зміни пароля.')
    } catch (resetError) {
      setError(`Не вдалося зв’язатися із сервісом пошти: ${(resetError as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function resendConfirmation() {
    if (!supabase) return
    setBusy(true)
    setError('')
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: authEmail,
        options: { emailRedirectTo: authRedirectUrl() },
      })
      if (resendError) setError(`Не вдалося надіслати лист підтвердження: ${resendError.message}`)
      else setNotice('Лист підтвердження надіслано повторно. Перевірте також папку «Спам».')
    } catch (resendError) {
      setError(`Не вдалося надіслати лист: ${(resendError as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function sendAccountPasswordReset() {
    const email = session?.user.email
    if (!supabase || !email) {
      setError('Не вдалося визначити пошту акаунта для відновлення пароля.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: authRedirectUrl(),
      })
      if (resetError) setError(`Не вдалося надіслати лист: ${resetError.message}`)
      else setNotice('Лист для зміни пароля надіслано на адресу акаунта.')
    } catch (resetError) {
      setError(`Не вдалося надіслати лист: ${(resetError as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function updatePassword(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    if (authPassword.length < 8) {
      setError('Новий пароль має містити щонайменше 8 символів.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: authPassword })
      if (updateError) setError(`Не вдалося змінити пароль: ${updateError.message}`)
      else {
        setAuthPassword('')
        setAuthMode('signin')
        setNotice('Пароль оновлено. Ваш акаунт готовий до роботи.')
      }
    } catch (updateError) {
      setError(`Не вдалося змінити пароль: ${(updateError as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    try {
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) setError(`Не вдалося вийти з акаунта: ${signOutError.message}`)
      else setTasks([])
    } catch (signOutError) {
      setError(`Не вдалося вийти з акаунта: ${(signOutError as Error).message}`)
    }
  }

  async function deleteAccount(event: FormEvent) {
    event.preventDefault()
    if (accountConfirmation !== 'DELETE' || !supabase) {
      setError('Для підтвердження введіть DELETE.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { error: deleteError } = await supabase.rpc('delete_my_account')
      if (deleteError) {
        setError(`Не вдалося видалити акаунт: ${deleteError.message}`)
        return
      }
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
      setTasks([])
      setSession(null)
      setAuthMode('signin')
      if (signOutError) setError('Акаунт і завдання видалено, але локальний сеанс не завершився. Перезавантажте сторінку.')
      else setNotice('Акаунт і пов’язані із ним завдання видалено.')
      setShowDeleteAccount(false)
      setAccountConfirmation('')
    } catch (deleteError) {
      setError(`Не вдалося видалити акаунт: ${(deleteError as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  function switchToLocal() {
    sessionStorage.setItem('deadline-radar-local-mode', 'true')
    setLocalMode(true)
    setSession(null)
    loadedUserRef.current = ''
    setLoadedUserId('')
    const localData = readLocalTasks()
    setTasks(localData.tasks)
    setError(localData.error)
  }

  function switchToAccount() {
    sessionStorage.removeItem('deadline-radar-local-mode')
    setLocalMode(false)
    setAuthReady(false)
    loadedUserRef.current = ''
    setLoadedUserId('')
    setTasks([])
    setError('')
  }

  function openCreate() {
    setEditing(null)
    setDraft(blankDraft)
    setError('')
    setShowForm(true)
  }

  function openEdit(task: Task) {
    setEditing(task)
    setError('')
    setDraft({
      title: task.title, subject: task.subject, due: toLocalInput(task.due),
      description: task.description, link: task.link, status: task.status,
      priority: task.priority, repeat: task.repeat, repeatDay: task.repeatDay, remind: task.remind,
    })
    setShowForm(true)
  }

  async function saveTask(event: FormEvent) {
    event.preventDefault()
    if (!draft.title.trim() || !draft.subject.trim() || !draft.due) return
    if (!isSafeTaskLink(draft.link.trim())) {
      setError('Посилання має починатися з http:// або https://.')
      return
    }
    const updated: Task = {
      ...draft, id: editing?.id ?? crypto.randomUUID(),
      title: draft.title.trim(), subject: draft.subject.trim(),
      due: new Date(draft.due).toISOString(),
      repeatDay: draft.repeat === 'monthly' ? new Date(draft.due).getDate() : null,
    }
    if (await persist([updated])) {
      setShowForm(false)
      setNotice(editing ? 'Завдання оновлено.' : 'Завдання додано.')
    }
  }

  async function cycleStatus(task: Task) {
    const nextStatus: TaskStatus = task.status === 'todo' ? 'progress' : task.status === 'progress' ? 'done' : 'todo'
    const changed: Task[] = [{ ...task, status: nextStatus }]
    if (nextStatus === 'done' && task.repeat !== 'none') {
      const due = nextOccurrence(task.due, task.repeat, task.repeatDay)
      if (due) changed.push({ ...task, id: crypto.randomUUID(), due, status: 'todo' })
    }
    if (await persist(changed)) setNotice(nextStatus === 'done' && changed.length > 1 ? 'Виконано. Наступне повторення додано до плану.' : `Статус: ${statusLabels[nextStatus].toLocaleLowerCase('uk')}.`)
  }

  async function deleteTask(task: Task) {
    if (!window.confirm(`Видалити завдання «${task.title}»?`)) return
    if (await persist([], task.id)) setNotice('Завдання видалено.')
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tasks }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `deadline-radar-${new Date().toISOString().slice(0, 10)}.json`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice('Резервну копію завантажено.')
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const imported = parseTaskBackup(await file.text())
      const unique = imported.map((task) => ({ ...task, id: crypto.randomUUID() }))
      if (unique.length === 0) setNotice('У резервній копії немає завдань для імпорту.')
      else if (await persist(unique)) setNotice(`Імпортовано завдань: ${unique.length}.`)
    } catch (importError) {
      setError(`Не вдалося імпортувати файл: ${(importError as Error).message}`)
    }
    event.target.value = ''
  }

  async function enableReminders() {
    if (!('Notification' in window)) {
      setError('Цей браузер не підтримує сповіщення.')
      return
    }
    const result = await Notification.requestPermission()
    setPermission(result)
    if (result === 'granted') {
      setRemindersEnabled(true)
      localStorage.setItem('deadline-radar-reminders', 'true')
      setNotice('Нагадування увімкнено. Сповіщення показуються за 30 хвилин до дедлайну, поки відкрита сторінка.')
    } else {
      setRemindersEnabled(false)
      localStorage.setItem('deadline-radar-reminders', 'false')
      setError(result === 'denied' ? 'Дозвіл на сповіщення заборонено у браузері. Змініть його в налаштуваннях сайту.' : 'Дозвіл на сповіщення не надано.')
    }
  }

  useEffect(() => {
    if (!remindersEnabled || permission !== 'granted') return
    const check = () => {
      const time = Date.now()
      const notified = JSON.parse(sessionStorage.getItem('deadline-radar-notified') ?? '[]') as string[]
      for (const task of tasks) {
        const delta = new Date(task.due).getTime() - time
        if (task.remind && task.status !== 'done' && delta > 0 && delta <= 30 * 60 * 1000 && !notified.includes(task.id)) {
          new Notification('Дедлайн за 30 хвилин', { body: `${task.title} · ${task.subject}` })
          notified.push(task.id)
        }
      }
      sessionStorage.setItem('deadline-radar-notified', JSON.stringify(notified))
    }
    check()
    const timer = window.setInterval(check, 60_000)
    return () => window.clearInterval(timer)
  }, [remindersEnabled, permission, tasks])

  if (supabaseConfigured && !localMode && (!authReady || (session && (busy || loadedUserId !== session.user.id)))) {
    return <div className="loading-screen"><LoaderCircle className="spin" size={32} /><p>Підключаємо твій простір…</p></div>
  }

  if (supabaseConfigured && !localMode && session && authMode === 'recovery') {
    return <AuthScreen key={authMode} email={authEmail} password={authPassword} mode={authMode} busy={busy} error={error} notice={notice} confirmationPending={false} onEmail={setAuthEmail} onPassword={setAuthPassword} onMode={changeAuthMode} onSubmit={updatePassword} onGoogle={signInWithGoogle} onForgot={sendPasswordReset} onResend={resendConfirmation} onLocal={switchToLocal} />
  }

  if (supabaseConfigured && !localMode && !session) {
    return <AuthScreen key={authMode} email={authEmail} password={authPassword} mode={authMode} busy={busy} error={error} notice={notice} confirmationPending={confirmationPending} onEmail={setAuthEmail} onPassword={setAuthPassword} onMode={changeAuthMode} onSubmit={submitAuth} onGoogle={signInWithGoogle} onForgot={sendPasswordReset} onResend={resendConfirmation} onLocal={switchToLocal} />
  }

  const cloudMode = supabaseConfigured && !localMode
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="Deadline Radar — на головну"><span className="brand-mark"><Target size={19} /></span><span>deadline<span className="brand-light">.radar</span></span></a>
        <nav className="main-nav" aria-label="Головна навігація">
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><LayoutList size={16} /> Завдання</button>
          <button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}><CalendarDays size={16} /> Календар</button>
        </nav>
        <div className="account-actions">
          <span className={`sync-state ${cloudMode ? 'cloud' : 'local'}`}><span />{cloudMode ? 'Синхронізація увімкнена' : 'Лише цей пристрій'}</span>
          {cloudMode ? <details className="account-menu"><summary aria-label="Меню акаунта"><span className="account-avatar">{(session?.user.email ?? 'U').slice(0, 1).toLocaleUpperCase('uk')}</span><span className="account-email">{session?.user.email}</span><ChevronDown size={14} /></summary><div className="account-menu-panel"><span className="menu-account-label">{session?.user.email}</span><button onClick={sendAccountPasswordReset}><KeyRound size={15} /> Надіслати лист для зміни пароля</button><button className="menu-danger" onClick={() => { setAccountConfirmation(''); setShowDeleteAccount(true) }}><Trash2 size={15} /> Видалити акаунт</button><button onClick={signOut}><LogOut size={15} /> Вийти</button></div></details> :
            supabaseConfigured ? <button className="quiet-button" onClick={switchToAccount}>Увійти в акаунт</button> : null}
        </div>
      </header>
      <main id="home">
        <section className="welcome">
          <div><p className="eyebrow"><Sparkles size={14} /> Твій навчальний простір</p><h1>Навчайся у своєму<br /><span>ритмі.</span></h1><p className="welcome-copy">Усі дедлайни в одному місці. Спокійно, чітко, під контролем.</p></div>
          <div className="welcome-art" aria-hidden="true"><div className="art-ring ring-a" /><div className="art-ring ring-b" /><span className="art-star star-a">✳</span><span className="art-star star-b">✦</span><Target size={58} strokeWidth={1.2} /></div>
        </section>
        {!cloudMode && <div className="mode-notice"><ShieldCheck size={18} /><div><strong>{supabaseConfigured ? 'Ви працюєте локально' : supabaseConfigError ? 'Неповна конфігурація Supabase' : 'Supabase не налаштований — локальний режим'}</strong><p>{supabaseConfigError || 'Завдання зберігаються лише у браузері цього пристрою. Для синхронізації між пристроями налаштуйте Supabase та перезапустіть застосунок. Завантажте резервну копію, щоб не втратити дані.'}</p></div><BackupButtons onExport={exportBackup} onImport={importBackup} /></div>}
        {error && <div className="feedback error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Закрити повідомлення"><X size={16} /></button></div>}
        {notice && <div className="feedback success" role="status"><CheckCircle2 size={16} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Закрити повідомлення"><X size={16} /></button></div>}
        <section className="summary-grid" aria-label="Підсумок дедлайнів">
          <SummaryCard label="Прострочені" count={overdueCount} tone="red" icon={<Clock3 size={18} />} active={dueFilter === 'overdue'} onClick={() => { setDueFilter(dueFilter === 'overdue' ? 'all' : 'overdue'); setView('list') }} />
          <SummaryCard label="На сьогодні" count={todayCount} tone="amber" icon={<CalendarDays size={18} />} active={dueFilter === 'today'} onClick={() => { setDueFilter(dueFilter === 'today' ? 'all' : 'today'); setView('list') }} />
          <SummaryCard label="Наступні 7 днів" count={upcomingCount} tone="violet" icon={<ArrowRight size={18} />} active={dueFilter === 'upcoming'} onClick={() => { setDueFilter(dueFilter === 'upcoming' ? 'all' : 'upcoming'); setView('list') }} />
          <CompletionCard done={doneCount} total={tasks.length} active={statusFilter === 'done'} onClick={() => { setStatusFilter(statusFilter === 'done' ? 'all' : 'done'); setDueFilter('all'); setView('list') }} />
        </section>
        <section className="planner">
          <div className="planner-heading"><div><p className="eyebrow">Твій план</p><h2>{view === 'list' ? 'Мої завдання' : 'Календар дедлайнів'} <span>{tasks.length}</span></h2></div><button className="primary-button" onClick={openCreate}><Plus size={18} /> Нове завдання</button></div>
          <div className="toolbar">
            <label className="search-box"><Search size={17} /><span className="sr-only">Пошук завдань</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Знайти завдання або предмет…" />{query && <button onClick={() => setQuery('')} aria-label="Очистити пошук"><X size={15} /></button>}</label>
            <label className="select-box"><Filter size={16} /><span className="sr-only">Фільтр за предметом</span><select value={subject} onChange={(event) => setSubject(event.target.value)}><option value="all">Усі предмети</option>{subjects.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label>
            <label className="select-box"><CheckCircle2 size={16} /><span className="sr-only">Фільтр за статусом</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as FilterStatus)}><option value="all">Усі статуси</option><option value="todo">Не розпочато</option><option value="progress">В процесі</option><option value="done">Виконано</option></select><ChevronDown size={14} /></label>
            <label className="select-box sort-box"><ArrowDownUp size={16} /><span className="sr-only">Сортування</span><select value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="due">За дедлайном</option><option value="priority">За пріоритетом</option><option value="newest">Пізніші спочатку</option></select><ChevronDown size={14} /></label>
          </div>
          {view === 'list' ? <div className="task-board">{(['overdue', 'today', 'week', 'later'] as const).map((group) =>
            <TaskGroup key={group} group={group} tasks={groups[group]} onStatus={cycleStatus} onEdit={openEdit} onDelete={deleteTask} />,
          )}</div> : <CalendarView month={month} selectedDate={selectedDate} tasks={filteredTasks} onMonth={(nextMonth) => { setMonth(nextMonth); setSelectedDate(localDateKey(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1))) }} onSelect={setSelectedDate} onStatus={cycleStatus} onEdit={openEdit} onDelete={deleteTask} />}
        </section>
        <section className="tools-row">
          <div className="reminder-control"><div className="tool-icon">{remindersEnabled ? <Bell size={17} /> : <BellOff size={17} />}</div><div><strong>Нагадування у браузері</strong><p>{!('Notification' in window) ? 'Браузер не підтримує сповіщення' : permission === 'denied' ? 'Дозвіл вимкнений у налаштуваннях браузера' : remindersEnabled ? 'Увімкнено · за 30 хв до дедлайну' : 'Вимкнено · увімкніть за бажанням'}</p></div><button className={remindersEnabled ? 'toggle enabled' : 'toggle'} role="switch" aria-checked={remindersEnabled} aria-label="Увімкнути нагадування" onClick={() => remindersEnabled ? (setRemindersEnabled(false), localStorage.setItem('deadline-radar-reminders', 'false')) : enableReminders()}><span /></button></div>
          <div className="backup-control"><BackupButtons onExport={exportBackup} onImport={importBackup} /></div>
        </section>
        <footer className="footer"><span><Target size={15} /> deadline.radar</span><span className="footer-legal"><a href={`${import.meta.env.BASE_URL}privacy.html`}>Приватність</a><a href={`${import.meta.env.BASE_URL}terms.html`}>Умови</a></span><CoffeeLink compact /><span>{cloudMode ? 'Ваші дані захищені політиками доступу акаунта.' : 'Локальні дані залишаються у цьому браузері.'}</span></footer>
      </main>
      {showForm && <TaskModal draft={draft} editing={Boolean(editing)} error={error} onChange={setDraft} onClose={() => setShowForm(false)} onSubmit={saveTask} />}
      {showDeleteAccount && <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && setShowDeleteAccount(false)}><form className="modal account-delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-account-title" onSubmit={deleteAccount}><div className="modal-head"><div><p className="eyebrow">Небезпечна дія</p><h2 id="delete-account-title">Видалити акаунт?</h2></div><button type="button" className="icon-button" onClick={() => setShowDeleteAccount(false)} aria-label="Закрити"><X size={19} /></button></div><p>Акаунт і всі його хмарні завдання буде видалено без можливості відновлення. Перед продовженням завантаж резервну копію, якщо хочеш зберегти дані.</p>{error && <div className="feedback error" role="alert">{error}</div>}<label className="field-label">Для підтвердження введи <strong>DELETE</strong><input autoComplete="off" required value={accountConfirmation} onChange={(event) => setAccountConfirmation(event.target.value)} placeholder="DELETE" /></label><div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setShowDeleteAccount(false)}>Скасувати</button><button className="delete-account-button" type="submit" disabled={busy || accountConfirmation !== 'DELETE'}>{busy ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={15} />} Видалити назавжди</button></div></form></div>}
    </div>
  )

  function changeAuthMode(mode: AuthMode) {
    setAuthMode(mode)
    setAuthPassword('')
    setConfirmationPending(false)
    setNotice('')
    setError('')
  }
}

function mergeTasks(current: Task[], changed: Task[]) {
  const next = new Map(current.map((task) => [task.id, task]))
  changed.forEach((task) => next.set(task.id, task))
  return [...next.values()]
}

function toLocalInput(value: string) {
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function AuthScreen({ email, password, mode, busy, error, notice, confirmationPending, onEmail, onPassword, onMode, onSubmit, onGoogle, onForgot, onResend, onLocal }: {
  email: string
  password: string
  mode: AuthMode
  busy: boolean
  error: string
  notice: string
  confirmationPending: boolean
  onEmail: (value: string) => void
  onPassword: (value: string) => void
  onMode: (value: AuthMode) => void
  onSubmit: (event: FormEvent) => void
  onGoogle: () => void
  onForgot: (event: FormEvent) => void
  onResend: () => void
  onLocal: () => void
}) {
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [termsError, setTermsError] = useState('')
  const recovery = mode === 'recovery'
  const reset = mode === 'reset'
  const signup = mode === 'signup'
  const title = recovery ? 'Створи новий пароль' : reset ? 'Відновити пароль' : signup ? 'Створи акаунт' : 'Увійти в акаунт'
  const submitText = recovery ? 'Зберегти пароль' : reset ? 'Надіслати посилання' : signup ? 'Зареєструватися' : 'Увійти'

  function handleGoogle() {
    if (!termsAccepted) {
      setTermsError('Для входу через Google прийміть умови та політику приватності.')
      return
    }
    onGoogle()
  }

  return (
    <div className="auth-screen">
      <div className="auth-aside">
        <a className="brand" href="#"><span className="brand-mark"><Target size={19} /></span><span>deadline<span className="brand-light">.radar</span></span></a>
        <div className="auth-hero">
          <p className="eyebrow"><Sparkles size={14} /> Твій навчальний простір</p>
          <h1>Твій фокус.<br /><span>Твої цілі.</span></h1>
          <p>Увійди, щоб завдання синхронізувались на всіх твоїх пристроях.</p>
          <div className="auth-art"><Target size={82} strokeWidth={1.1} /></div>
        </div>
        <span className="auth-foot">Твої дедлайни — у безпеці.</span>
      </div>
      <div className="auth-panel">
        <div className="auth-form">
          <div className="auth-mobile-brand"><span className="brand-mark"><Target size={19} /></span> deadline.radar</div>
          <p className="eyebrow">{recovery ? 'Відновлення акаунта' : reset ? 'Повернення доступу' : signup ? 'Почни планувати' : 'Раді тебе бачити'}</p>
          <h2>{title}</h2>
          <p className="auth-intro">{recovery ? 'Вигадай надійний пароль, щоб захистити свій акаунт.' : reset ? 'Вкажи пошту акаунта. Якщо він існує, надішлемо посилання для відновлення.' : 'Доступ до твого особистого плану з будь-якого пристрою.'}</p>
          {error && <div className="feedback error" role="alert">{error}</div>}
          {termsError && <div className="feedback error" role="alert">{termsError}</div>}
          {notice && <div className="feedback success" role="status">{notice}</div>}
          <form onSubmit={reset ? onForgot : onSubmit}>
            <label className="field-label">Електронна пошта
              <input type="email" autoComplete="email" required value={email} onChange={(event) => onEmail(event.target.value)} placeholder="name@example.com" disabled={recovery} />
            </label>
            {!reset && <label className="field-label">{recovery ? 'Новий пароль' : 'Пароль'}
              <input type="password" autoComplete={recovery ? 'new-password' : signup ? 'new-password' : 'current-password'} required minLength={signup || recovery ? 8 : 6} value={password} onChange={(event) => onPassword(event.target.value)} placeholder={signup || recovery ? 'Щонайменше 8 символів' : 'Твій пароль'} />
            </label>}
            {!reset && !recovery && <label className="terms-consent"><input type="checkbox" required={signup} checked={termsAccepted} onChange={(event) => { setTermsAccepted(event.target.checked); setTermsError('') }} /><span>Я погоджуюся з <a href={`${import.meta.env.BASE_URL}terms.html`} target="_blank" rel="noreferrer">умовами користування</a> та <a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noreferrer">політикою приватності</a>.</span></label>}
            {mode === 'signin' && <button className="forgot-password" type="button" onClick={() => onMode('reset')}>Забув(ла) пароль?</button>}
            <button className="primary-button auth-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : reset ? <Mail size={16} /> : recovery ? <KeyRound size={16} /> : null}{submitText}</button>
          </form>
          {confirmationPending && <button className="resend-confirmation" type="button" disabled={busy} onClick={onResend}>Не прийшов лист? Надіслати ще раз</button>}
          {reset || recovery
            ? <p className="auth-switch"><button type="button" onClick={() => onMode('signin')}>← Повернутися до входу</button></p>
            : <>
              <p className="auth-switch">{signup ? 'Вже маєш акаунт?' : 'Ще немає акаунта?'} <button type="button" onClick={() => onMode(signup ? 'signin' : 'signup')}>{signup ? 'Увійди' : 'Зареєструйся'}</button></p>
              <div className="auth-separator"><span>або продовжити з</span></div>
              <button type="button" className="google-button" disabled={busy} onClick={handleGoogle}><GoogleMark /> Продовжити з Google</button>
              <div className="auth-separator"><span>або без акаунта</span></div>
              <button type="button" className="local-choice" onClick={onLocal}>Продовжити лише на цьому пристрої</button>
            </>}
          <p className="auth-security"><ShieldCheck size={15} /> Пароль захищено Supabase Auth. Ми його не зберігаємо.</p>
          <p className="auth-legal"><a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noreferrer">Приватність</a><span>·</span><a href={`${import.meta.env.BASE_URL}terms.html`} target="_blank" rel="noreferrer">Умови користування</a></p>
          <CoffeeLink />
        </div>
      </div>
    </div>
  )
}

function GoogleMark() {
  return <svg className="google-mark" aria-hidden="true" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.75 7.18l7.68 5.96c4.48-4.14 7.11-10.24 7.11-17.61Z" /><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.54 2.56 10.78l7.97-6.19Z" /><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.84l-7.68-5.96c-2.13 1.43-4.85 2.3-8.22 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" /></svg>
}

function CoffeeLink({ compact = false }: { compact?: boolean }) {
  return <a
    className={`coffee-link${compact ? ' compact' : ''}`}
    href="https://donatello.to/solonetsavipz24-prog/about"
    target="_blank"
    rel="noopener noreferrer"
    referrerPolicy="no-referrer"
    aria-label="Підтримати Deadline Radar на Donatello"
  >
    <Heart size={compact ? 14 : 16} />
    <span>{compact ? 'Підтримати' : 'Buy me a coffee'}</span>
    {!compact && <ExternalLink size={12} />}
  </a>
}

function SummaryCard({ label, count, tone, icon, active, onClick }: { label: string; count: number; tone: string; icon: ReactNode; active: boolean; onClick: () => void }) {
  return <button className={`summary-card ${tone} ${active ? 'selected' : ''}`} onClick={onClick}><span className="summary-icon">{icon}</span><span className="summary-label">{label}</span><strong>{count}</strong><span className="summary-link">Переглянути <ArrowRight size={13} /></span></button>
}

function CompletionCard({ done, total, active, onClick }: { done: number; total: number; active: boolean; onClick: () => void }) {
  const percentage = total ? Math.round((done / total) * 100) : 0
  return <button className={`completion-card ${active ? 'selected' : ''}`} onClick={onClick}><span className="completion-heading"><CheckCircle2 size={17} /> Виконано</span><span className="completion-count">{done}<small> / {total}</small></span><span className="completion-progress"><i style={{ width: `${percentage}%` }} /></span><span className="completion-caption">{percentage}% запланованого виконано</span></button>
}

function BackupButtons({ onExport, onImport }: { onExport: () => void; onImport: (event: ChangeEvent<HTMLInputElement>) => void }) {
  return <div className="backup-buttons"><button onClick={onExport} title="Експортувати резервну копію"><Download size={15} /><span>Експорт</span></button><label title="Імпортувати резервну копію"><Upload size={15} /><span>Імпорт</span><input type="file" accept="application/json,.json" onChange={onImport} /></label></div>
}

function TaskGroup({ group, tasks, onStatus, onEdit, onDelete }: { group: keyof typeof groupLabels; tasks: Task[]; onStatus: (task: Task) => void; onEdit: (task: Task) => void; onDelete: (task: Task) => void }) {
  return <section className={`task-group ${group}`} aria-label={`${groupLabels[group]}, ${tasks.length} завдань`}><div className="group-title"><span className="group-marker" /><h3>{groupLabels[group]}</h3><span className="group-count">{tasks.length}</span></div>{tasks.length ? <div className="task-list">{tasks.map((task) => <TaskCard key={task.id} task={task} onStatus={onStatus} onEdit={onEdit} onDelete={onDelete} />)}</div> : <div className="empty-state"><span>{group === 'overdue' ? '✦' : '·'}</span><p>{group === 'overdue' ? 'Чудово! Прострочених завдань немає.' : 'Поки нічого — можна видихнути.'}</p></div>}</section>
}

function TaskCard({ task, onStatus, onEdit, onDelete }: { task: Task; onStatus: (task: Task) => void; onEdit: (task: Task) => void; onDelete: (task: Task) => void }) {
  const due = new Date(task.due)
  const dateLabel = due.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })
  const timeLabel = due.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
  return <article className={`task-card ${task.status}`}><button className={`status-check ${task.status}`} onClick={() => onStatus(task)} aria-label={`Змінити статус: ${statusLabels[task.status]}`} title="Змінити статус">{task.status === 'done' ? <Check size={14} /> : task.status === 'progress' ? <span /> : <Circle size={18} />}</button><div className="task-content"><div className="task-meta"><span className="subject-tag">{task.subject}</span><span className={`priority-tag ${task.priority}`}>{task.priority === 'high' ? '↑' : task.priority === 'low' ? '↓' : '•'} {priorityLabels[task.priority]}</span><span className="task-date"><CalendarDays size={14} />{dateLabel} <b>·</b> {timeLabel}</span></div><h4>{task.title}</h4>{task.description && <p className="task-description">{task.description}</p>}<div className="task-bottom"><span className={`status-label ${task.status}`}>{statusLabels[task.status]}</span><div className="task-traits">{task.repeat !== 'none' && <span title={repeatLabels[task.repeat]}>↻ {repeatLabels[task.repeat]}</span>}{task.remind && <span title="Нагадування увімкнене"><Bell size={13} /></span>}{task.link && <a href={task.link} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Посилання</a>}</div><div className="task-actions"><button onClick={() => onEdit(task)} aria-label={`Редагувати: ${task.title}`} title="Редагувати"><Pencil size={15} /></button><button onClick={() => onDelete(task)} aria-label={`Видалити: ${task.title}`} title="Видалити"><Trash2 size={15} /></button></div></div></div></article>
}

function CalendarView({ month, selectedDate, tasks, onMonth, onSelect, onStatus, onEdit, onDelete }: {
  month: Date; selectedDate: string; tasks: Task[]; onMonth: (date: Date) => void; onSelect: (date: string) => void
  onStatus: (task: Task) => void; onEdit: (task: Task) => void; onDelete: (task: Task) => void
}) {
  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const firstMondayOffset = (new Date(year, monthIndex, 1).getDay() + 6) % 7
  const days = new Date(year, monthIndex + 1, 0).getDate()
  const cells = Array.from({ length: Math.ceil((firstMondayOffset + days) / 7) * 7 }, (_, index) => index - firstMondayOffset + 1)
  const dayKey = (day: number) => localDateKey(new Date(year, monthIndex, day))
  const dayTasks = (day: number) => tasks.filter((task) => localDateKey(new Date(task.due)) === dayKey(day))
  const selectedTasks = tasks.filter((task) => localDateKey(new Date(task.due)) === selectedDate)
  return <div className="calendar-view"><div className="calendar-panel"><div className="calendar-heading"><div><p className="eyebrow">Планування</p><h3>{month.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })}</h3></div><div className="month-controls"><button aria-label="Попередній місяць" onClick={() => onMonth(new Date(year, monthIndex - 1, 1))}><ArrowLeft size={17} /></button><button aria-label="Наступний місяць" onClick={() => onMonth(new Date(year, monthIndex + 1, 1))}><ArrowRight size={17} /></button></div></div><div className="calendar-grid">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'].map((day) => <span className="weekday" key={day}>{day}</span>)}{cells.map((day, index) => day < 1 || day > days ? <span className="calendar-blank" key={index} /> : <button key={day} onClick={() => onSelect(dayKey(day))} className={`calendar-day ${selectedDate === dayKey(day) ? 'selected' : ''} ${dayTasks(day).length ? 'has-tasks' : ''}`}><span>{day}</span>{dayTasks(day).length > 0 && <i>{dayTasks(day).length}</i>}</button>)}</div></div><aside className="calendar-agenda"><p className="eyebrow">Обраний день</p><h3>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}</h3>{selectedTasks.length ? selectedTasks.map((task) => <div className="agenda-item" key={task.id}><span className={`agenda-dot ${task.priority}`} /><div><strong>{task.title}</strong><span>{new Date(task.due).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })} · {task.subject}</span><div className="agenda-actions"><button onClick={() => onStatus(task)}>{statusLabels[task.status]}</button><button onClick={() => onEdit(task)} aria-label="Редагувати"><Pencil size={13} /></button><button onClick={() => onDelete(task)} aria-label="Видалити"><Trash2 size={13} /></button></div></div></div>) : <div className="empty-state"><p>На цей день завдань немає.</p></div>}</aside></div>
}

function TaskModal({ draft, editing, error, onChange, onClose, onSubmit }: { draft: TaskDraft; editing: boolean; error: string; onChange: (draft: TaskDraft) => void; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
  const field = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => onChange({ ...draft, [key]: value })
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onClose()}><form className="modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title" onSubmit={onSubmit}><div className="modal-head"><div><p className="eyebrow">{editing ? 'Онови завдання' : 'Нове завдання'}</p><h2 id="task-modal-title">{editing ? 'Редагувати' : 'Що потрібно зробити?'}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Закрити"><X size={19} /></button></div>{error && <div className="feedback error" role="alert">{error}</div>}<label className="field-label">Назва завдання<input autoFocus required maxLength={200} value={draft.title} onChange={(event) => field('title', event.target.value)} placeholder="Наприклад, здати лабораторну" /></label><div className="form-grid"><label className="field-label">Предмет<input required maxLength={100} value={draft.subject} onChange={(event) => field('subject', event.target.value)} placeholder="Програмування" /></label><label className="field-label">Дата й час<input required type="datetime-local" value={draft.due} onChange={(event) => field('due', event.target.value)} /></label></div><div className="form-grid"><label className="field-label">Пріоритет<select value={draft.priority} onChange={(event) => field('priority', event.target.value as TaskPriority)}><option value="high">Високий</option><option value="medium">Середній</option><option value="low">Низький</option></select></label><label className="field-label">Повторення<select value={draft.repeat} onChange={(event) => field('repeat', event.target.value as RepeatRule)}>{Object.entries(repeatLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><label className="field-label">Опис <span>(необов’язково)</span><textarea value={draft.description} onChange={(event) => field('description', event.target.value)} placeholder="Деталі або план дій" rows={3} /></label><label className="field-label">Посилання <span>(необов’язково)</span><div className="input-with-icon"><LinkIcon size={16} /><input type="url" pattern="https?://.*" title="Введіть адресу, що починається з http:// або https://" value={draft.link} onChange={(event) => field('link', event.target.value)} placeholder="https://..." /></div></label>{editing && <label className="field-label">Статус<select value={draft.status} onChange={(event) => field('status', event.target.value as TaskStatus)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}<label className="remind-check"><input type="checkbox" checked={draft.remind} onChange={(event) => field('remind', event.target.checked)} /><span><Bell size={15} /> Нагадати за 30 хвилин до дедлайну</span></label><div className="modal-actions"><button type="button" className="quiet-button" onClick={onClose}>Скасувати</button><button className="primary-button submit" type="submit">{editing ? 'Зберегти зміни' : <><Plus size={17} /> Додати завдання</>}</button></div></form></div>
}

export default App
