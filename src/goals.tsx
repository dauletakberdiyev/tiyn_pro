import { useState } from 'react';
import { useApp } from './context';
import { Empty, Field, Form, Icon, IconButton, Money, SectionTitle } from './components';
import { accountBalance, formatDate, id, moneyInput, parseMoney, savingsGoalProgress, type SavingsGoal } from '../supabase/functions/_shared/domain.ts';

function GoalSummary({ goal }: { goal: SavingsGoal }) {
  const { book, date } = useApp();
  const account = book.accounts.find(a => a.id === goal.accountId)!;
  const progress = savingsGoalProgress(book, goal, date);
  return <span className="goal-summary">
    <span className="goal-heading"><span className="goal-symbol" style={{ color: account.color }}><Icon name={progress.reached ? 'success' : 'target'} size={24} /></span><span><strong>{goal.name}</strong><small>{account.name}</small></span><span className="goal-percent">{progress.percent}%</span></span>
    <span className="goal-amounts"><Money book={book} value={progress.balance} /><span>из <Money book={book} value={goal.targetAmount} /></span></span>
    <span className="progress-track" role="progressbar" aria-label={`Прогресс цели «${goal.name}»`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><span style={{ width: `${progress.percent}%` }} /></span>
    <span className={`goal-status ${progress.reached ? 'positive' : ''}`}>{progress.reached ? <><Icon name="check" size={16} />Цель достигнута</> : <>Осталось <Money book={book} value={progress.remaining} /></>}</span>
    <span className="goal-timing">{goal.dueDate ? <span className={progress.overdue ? 'negative' : ''}>{progress.overdue ? 'Срок прошёл · ' : 'К '}{formatDate(goal.dueDate, { day: 'numeric', month: 'long', year: 'numeric' })}</span> : <span>Без срока</span>}{progress.monthly !== null && <span><Money book={book} value={progress.monthly} /> / мес.</span>}</span>
  </span>;
}

function GoalCard({ goal }: { goal: SavingsGoal }) {
  const { open } = useApp();
  return <button className="goal-card" onClick={() => open({ type: 'goal', id: goal.id })}><GoalSummary goal={goal} /></button>;
}

export function GoalsPanel({ home = false }: { home?: boolean }) {
  const { book, open } = useApp();
  const goals = book.goals.filter(g => !g.archived);
  if (home && !goals.length) return null;
  return <section className={`panel goals-panel ${home ? 'goals-home' : 'goals-budget'}`}>
    <SectionTitle title="Цели накоплений" aside={<IconButton icon="plus" label="Добавить цель" onClick={() => open({ type: 'goal' })} />} />
    {goals.length ? <div className="goal-list">{goals.slice(0, 3).map(goal => <GoalCard key={goal.id} goal={goal} />)}</div> : <Empty icon="target" title="На что вы копите?" text="Свяжите цель со счётом и следите, сколько осталось до нужной суммы." action={<button className="button secondary" onClick={() => open({ type: 'goal' })}>Создать цель</button>} />}
    {(goals.length > 0 || book.goals.some(g => g.archived)) && <button className="subtle-link" onClick={() => open({ type: 'goals' })}>Все цели<Icon name="right" size={14} /></button>}
  </section>;
}

export function GoalsList() {
  const { book, open } = useApp();
  const [archived, setArchived] = useState(false);
  const goals = book.goals.filter(g => g.archived === archived);
  return <>
    <div className="tabs"><button className={!archived ? 'active' : ''} onClick={() => setArchived(false)}>Активные</button><button className={archived ? 'active' : ''} onClick={() => setArchived(true)}>Архив</button></div>
    {goals.length ? <div className="goal-list">{goals.map(goal => archived ? <button className="goal-archive-row" key={goal.id} onClick={() => open({ type: 'goal', id: goal.id })}><Icon name="target" /><span><strong>{goal.name}</strong><small>{book.accounts.find(a => a.id === goal.accountId)?.name} · {goal.dueDate ? formatDate(goal.dueDate, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Без срока'}</small><Money book={book} value={goal.targetAmount} /><small className="goal-restore-label">Восстановить цель</small></span><Icon name="right" size={16} /></button> : <GoalCard key={goal.id} goal={goal} />)}</div> : <Empty icon="target" title={archived ? 'В архиве пока нет целей' : 'Пока нет активных целей'} text={archived ? 'Здесь останутся параметры архивированных целей.' : 'Выберите счёт и сумму, которую хотите накопить.'} />}
    <button className="button primary" onClick={() => open({ type: 'goal' })}><Icon name="plus" />Создать цель</button>
  </>;
}

export function GoalForm({ goalId }: { goalId?: string }) {
  const { book, date, busy, run, open, close, navigate, setFilters } = useApp();
  const goal = book.goals.find(g => g.id === goalId);
  const [newId] = useState(id());
  const [editing, setEditing] = useState(!goal || goal.archived);
  const [error, setError] = useState('');
  const occupied = (accountId: string) => book.goals.some(g => !g.archived && g.id !== goalId && g.accountId === accountId);
  const accounts = book.accounts.filter(a => !a.archived);
  const available = accounts.filter(a => !occupied(a.id));
  const [accountId, setAccountId] = useState(goal ? available.find(a => a.id === goal.accountId)?.id ?? '' : available.find(a => !a.included)?.id ?? available[0]?.id ?? '');

  if (goal && !editing) {
    const source = accounts.find(a => a.id !== goal.accountId && a.id === book.settings.defaultAccountId) ?? accounts.find(a => a.id !== goal.accountId);
    return <>
      <GoalSummary goal={goal} />
      <div className="goal-actions">
        <button className="button primary" disabled={!source || busy} onClick={() => open({ type: 'transaction', draft: { id: id(), kind: 'transfer', amount: 0, accountId: source!.id, toAccountId: goal.accountId, date, note: `Пополнение цели: ${goal.name}` } })}><Icon name="plus" />Пополнить</button>
        <button className="button secondary" onClick={() => { setFilters({ from: book.transactions.reduce((from, t) => t.date < from ? t.date : from, date), to: date, kind: 'all', categoryId: '', accountId: goal.accountId, search: '' }); close(); navigate('operations'); }}><Icon name="list" />Операции счёта</button>
      </div>
      {!source && <p className="small muted">Для перевода нужен ещё один счёт. <button className="text-button" onClick={() => open({ type: 'account', returnToGoal: { id: goal.id } })}>Добавить счёт</button></p>}
      <div className="goal-detail-footer"><button className="text-button" onClick={() => setEditing(true)}><Icon name="edit" size={16} />Редактировать</button><button className="text-button" disabled={busy} onClick={async () => {
        setError('');
        try { await run({ type: 'goal.save', goal: { ...goal, archived: true } }, 'Цель перенесена в архив'); open({ type: 'goals' }); }
        catch (e) { setError((e as Error).message); }
      }}>Архивировать</button></div>
      <p className="small muted">Прогресс равен остатку счёта. После архивирования деньги останутся на счёте, а счёт — накопительным.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </>;
  }
  if (!available.length) return <Empty icon="bank" title={accounts.length ? 'Нужен свободный счёт' : 'Сначала добавьте счёт'} text="Каждой активной цели нужен отдельный счёт. Можно создать новый или освободить счёт, архивировав другую цель." action={<><button className="button primary" onClick={() => open({ type: 'account', returnToGoal: { id: goalId } })}><Icon name="plus" />Добавить счёт</button><button className="text-button" onClick={() => open({ type: 'goals' })}>К списку целей</button></>} />;
  return <Form busy={busy} submit={goal?.archived ? 'Восстановить цель' : goal ? 'Сохранить изменения' : 'Создать цель'} onSubmit={async data => {
    const next: SavingsGoal = { id: goal?.id ?? newId, name: String(data.get('name') ?? '').trim(), targetAmount: parseMoney(String(data.get('targetAmount') ?? '')), accountId: String(data.get('accountId') ?? ''), dueDate: String(data.get('dueDate') ?? ''), archived: false };
    await run({ type: 'goal.save', goal: next }, goal?.archived ? 'Цель восстановлена' : goal ? 'Цель сохранена' : 'Цель создана');
    open({ type: 'goal', id: next.id }); setEditing(false);
  }} footer={goal && !goal.archived && <button type="button" className="text-button" onClick={() => { setAccountId(goal.accountId); setEditing(false); }}>Отменить редактирование</button>}>
    {goal?.archived && <p className="hint-box"><Icon name="info" />При восстановлении прогресс будет рассчитан по текущему остатку выбранного счёта.</p>}
    <Field label="Название"><input name="name" defaultValue={goal?.name ?? ''} placeholder="Например, первоначальный взнос" maxLength={120} required autoFocus /></Field>
    <Field label="Целевая сумма, ₸"><input name="targetAmount" inputMode="decimal" placeholder="0" defaultValue={goal ? moneyInput(goal.targetAmount) : ''} required /></Field>
    <Field label="Счёт накоплений"><select name="accountId" value={accountId} onChange={e => setAccountId(e.target.value)} required><option value="" disabled>Выберите свободный счёт</option>{accounts.map(a => <option key={a.id} value={a.id} disabled={occupied(a.id)}>{a.name}{occupied(a.id) ? ' · уже связан с целью' : ''}</option>)}</select></Field>
    {accountId && <p className="small muted">На счёте сейчас: <Money book={book} value={accountBalance(book, accountId, date)} /></p>}
    <Field label="Срок цели" hint="Необязательно. Покажем, сколько нужно откладывать в месяц"><input name="dueDate" type="date" defaultValue={goal?.dueDate ?? ''} /></Field>
    <p className="hint-box"><Icon name="info" />Весь остаток выбранного счёта будет относиться к цели. Счёт исключится из доступных денег на день. {goal && accountId !== goal.accountId ? 'Прежний счёт останется накопительным.' : 'Пополнения, снятия и записанные проценты банка обновят прогресс.'}</p>
  </Form>;
}
