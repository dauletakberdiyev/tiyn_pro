import { useState } from 'react';
import { useApp } from './context';
import type { Modal } from './context';
import { Empty, Field, Form, Icon, IconButton, Money, Toggle, icons } from './components';
import { accountBalance, allowance, debtBalance, exportCsv, formatDate, formatMoney, getBudget, id, moneyInput, monthEnd, monthOf, parseMoney, type Account, type Category, type Command, type Schedule, type Transaction } from '../supabase/functions/_shared/domain.ts';
import { parseText } from '../supabase/functions/_shared/parser.ts';
import { isDemo } from './store';
import { telegram } from './telegram';
import { TransactionRow } from './pages';

const value = (d: FormData, key: string) => String(d.get(key) ?? '').trim();
const colorOptions = ['#b8d18b', '#91b6cc', '#dfb980', '#cf9da7', '#aaa4d5', '#86bfc1'];
function AccountSelect({ name = 'accountId', initial, label = 'Счёт' }: { name?: string; initial?: string; label?: string }) {
  const { book } = useApp();
  return <Field label={label}><select name={name} defaultValue={initial || book.settings.defaultAccountId} required><option value="" disabled>Выберите счёт</option>{book.accounts.filter(a => !a.archived).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>;
}
function CategorySelect({ name = 'categoryId', type, initial }: { name?: string; type: 'expense' | 'income'; initial?: string }) {
  const { book } = useApp();
  const categories = book.categories.filter(c => c.type === type && !c.archived).sort((a, b) => book.transactions.filter(t => t.categoryId === b.id).length - book.transactions.filter(t => t.categoryId === a.id).length);
  return <Field label="Категория"><select name={name} defaultValue={initial ?? categories[0]?.id ?? ''} required><option value="" disabled>Выберите категорию</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>;
}
function ColorPicker({ initial }: { initial: string }) {
  return <Field label="Цвет"><div className="color-picker">{colorOptions.map(color => <label key={color} style={{ backgroundColor: color }}><input aria-label={`Цвет ${color}`} type="radio" name="color" value={color} defaultChecked={color === initial} /><span><Icon name="check" size={18} /></span></label>)}</div></Field>;
}
function Archive({ checked = false }: { checked?: boolean }) { return <label className="checkbox-row"><input type="checkbox" name="archived" defaultChecked={checked} /><span>Архивировать</span></label>; }

export function TransactionForm({ modal }: { modal: Modal }) {
  const { book, busy, run, open, close, date, removeTransaction, notify } = useApp();
  const existing = book.transactions.find(t => t.id === modal.id);
  const draft = existing ?? modal.draft;
  const [kind, setKind] = useState<Transaction['kind']>(draft?.kind ?? 'expense');
  const [txId] = useState(draft?.id ?? id());
  const special = existing && ['adjustment', 'debt_in', 'debt_out'].includes(existing.kind);
  const remove = async () => { if (!existing) return; try { await removeTransaction(existing); close(); } catch (e) { notify((e as Error).message); } };
  if (special) return <><div className="detail-amount"><Money book={book} value={existing.amount} /><p>{existing.note}</p><small>{formatDate(existing.date, { day: 'numeric', month: 'long', year: 'numeric' })} · {book.accounts.find(a => a.id === existing.accountId)?.name}</small></div><p className="small muted">Движение связано с остатком счёта или долгом. Для исправления удалите запись и создайте корректную в соответствующем разделе.</p><button className="button danger" disabled={busy} onClick={() => void remove()}><Icon name="trash" />Удалить с возможностью отмены</button></>;
  return <>
    <div className="tabs form-tabs">{(['expense', 'income', 'transfer', 'refund'] as const).map(type => <button key={type} className={kind === type ? 'active' : ''} onClick={() => setKind(type)}>{({ expense: 'Расход', income: 'Доход', transfer: 'Перевод', refund: 'Возврат' })[type]}</button>)}</div>
    <Form busy={busy} submit={existing ? 'Сохранить изменения' : 'Добавить операцию'} onSubmit={async data => {
      const transaction = { id: txId, kind, amount: parseMoney(value(data, 'amount')), accountId: value(data, 'accountId'), date: value(data, 'date'), note: value(data, 'note'), ...(kind === 'transfer' ? { toAccountId: value(data, 'toAccountId') } : { categoryId: value(data, 'categoryId') }) };
      await run({ type: 'transaction.save', transaction }, existing ? 'Изменения сохранены' : 'Операция добавлена'); close();
    }} footer={existing && <div className="form-actions"><button type="button" className="text-button" onClick={() => open({ type: 'transaction', draft: { ...existing, id: id(), date } })}><Icon name="copy" size={16} />Повторить</button><button type="button" className="text-button negative" onClick={() => void remove()} disabled={busy}><Icon name="trash" size={16} />Удалить</button></div>}>
      <Field label="Сумма, ₸"><input className="amount-input" name="amount" inputMode="decimal" placeholder="0" defaultValue={draft?.amount ? moneyInput(draft.amount) : ''} required autoFocus autoComplete="off" /></Field>
      <div className="form-two"><AccountSelect initial={draft?.accountId} label={kind === 'transfer' ? 'Откуда' : 'Счёт'} />{kind === 'transfer' ? <AccountSelect name="toAccountId" label="Куда" initial={draft?.toAccountId ?? book.accounts.find(a => !a.archived && a.id !== (draft?.accountId ?? book.settings.defaultAccountId))?.id} /> : <CategorySelect key={kind} type={kind === 'income' ? 'income' : 'expense'} initial={book.categories.some(c => c.id === draft?.categoryId && c.type === (kind === 'income' ? 'income' : 'expense')) ? draft?.categoryId : undefined} />}</div>
      <Field label="Дата"><input type="date" name="date" defaultValue={draft?.date ?? date} max={date} required /></Field>
      <Field label="Комментарий" hint="Необязательно"><input name="note" placeholder={kind === 'expense' ? 'Например, обед с друзьями' : 'Что это за операция?'} defaultValue={draft?.note ?? ''} maxLength={500} /></Field>
      {kind === 'refund' && <p className="hint-box"><Icon name="info" />Возврат увеличит остаток счёта и уменьшит расходы выбранной категории.</p>}
    </Form>
  </>;
}

export function AccountsList() {
  const { book, date, open } = useApp();
  return <><div className="management-list">{book.accounts.map(a => <button className="management-row" key={a.id} onClick={() => open({ type: 'account', id: a.id })}><span className="account-mark" style={{ color: a.color, backgroundColor: `${a.color}20` }}>{a.name.slice(0, 1)}</span><span><strong>{a.name}</strong><small>{a.archived ? 'В архиве' : a.id === book.settings.defaultAccountId ? 'Основной счёт' : a.included ? 'Для расходов' : 'Накопления'}</small></span><Money book={book} value={accountBalance(book, a.id, date)} /><Icon name="right" size={16} /></button>)}</div><button className="button primary" onClick={() => open({ type: 'account' })}><Icon name="plus" />Добавить счёт</button></>;
}
export function AccountForm({ accountId }: { accountId?: string }) {
  const { book, run, busy, close, open, date } = useApp();
  const account = book.accounts.find(a => a.id === accountId); const [newId] = useState(id());
  return <Form busy={busy} onSubmit={async data => {
    const next: Account = { id: account?.id ?? newId, name: value(data, 'name'), opening: account?.opening ?? parseMoney(value(data, 'opening')), color: value(data, 'color') || '#b8d18b', included: data.has('included'), archived: data.has('archived') };
    await run({ type: 'account.save', account: next, makeDefault: data.has('default') && !next.archived });
    close();
  }}>
    <Field label="Название"><input name="name" defaultValue={account?.name ?? ''} placeholder="Например, Kaspi Gold" maxLength={120} required autoFocus /></Field>
    {account ? <div className="account-balance-info"><span>Текущий остаток</span><Money value={accountBalance(book, account.id, date)} book={book} /><button type="button" className="text-button" onClick={() => open({ type: 'correct', id: account.id })}>Скорректировать остаток<Icon name="right" size={14} /></button></div> : <Field label="Начальный остаток, ₸" hint="Это деньги на счёте сейчас, а не доход месяца"><input name="opening" inputMode="decimal" defaultValue="0" required /></Field>}
    <ColorPicker initial={account?.color ?? '#b8d18b'} />
    <label className="checkbox-row"><input type="checkbox" name="included" defaultChecked={account?.included ?? true} /><span>Учитывать в доступных деньгах на день<small>Отключите для накоплений, которые не планируете тратить</small></span></label>
    <label className="checkbox-row"><input type="checkbox" name="default" defaultChecked={account?.id === book.settings.defaultAccountId} /><span>Основной счёт для новых операций</span></label>
    {account && <Archive checked={account.archived} />}
  </Form>;
}
export function CorrectForm({ accountId }: { accountId: string }) {
  const { book, busy, run, close, date } = useApp();
  return <Form busy={busy} onSubmit={async data => { await run({ type: 'account.correct', accountId, balance: parseMoney(value(data, 'balance')), date, note: value(data, 'note') }, 'Остаток скорректирован'); close(); }}><p className="hint-box"><Icon name="info" />Разница будет записана отдельной корректировкой. Доходы и расходы не изменятся.</p><Field label="Фактический остаток, ₸"><input name="balance" inputMode="decimal" defaultValue={moneyInput(accountBalance(book, accountId, date))} required /></Field><Field label="Причина"><input name="note" placeholder="Например, сверка с банком" /></Field></Form>;
}

export function BudgetForm() {
  const { book, month, busy, run, close } = useApp(); const budget = getBudget(book, month);
  return <Form busy={busy} onSubmit={async data => {
    const limits = book.categories.filter(c => c.type === 'expense' && !c.archived).flatMap(c => { const text = value(data, c.id); const amount = text ? parseMoney(text) : 0; return amount ? [{ categoryId: c.id, amount }] : []; });
    await run({ type: 'budget.save', budget: { month, amount: parseMoney(value(data, 'amount') || '0'), limits } }, 'Бюджет сохранён'); close();
  }}><Field label="Бюджет месяца, ₸" hint="Оставьте 0, если общий лимит пока не нужен"><input name="amount" inputMode="decimal" defaultValue={moneyInput(budget.amount)} /></Field><h3>Лимиты категорий</h3><p className="small muted">Пустое поле означает отсутствие лимита.</p><div className="limit-fields">{book.categories.filter(c => c.type === 'expense' && !c.archived).map(c => <label className="limit-field" key={c.id}><Icon name={c.icon} /><span>{c.name}</span><input aria-label={`Лимит: ${c.name}`} name={c.id} inputMode="decimal" placeholder="Без лимита" defaultValue={budget.limits.find(l => l.categoryId === c.id) ? moneyInput(budget.limits.find(l => l.categoryId === c.id)!.amount) : ''} /></label>)}</div></Form>;
}

export function CategoryList() {
  const { book, open } = useApp(); const [type, setType] = useState<'expense' | 'income'>('expense');
  return <><div className="tabs"><button className={type === 'expense' ? 'active' : ''} onClick={() => setType('expense')}>Расходы</button><button className={type === 'income' ? 'active' : ''} onClick={() => setType('income')}>Доходы</button></div><div className="management-list">{book.categories.filter(c => c.type === type).map(c => <button className="management-row" key={c.id} onClick={() => open({ type: 'category', id: c.id })}><span className="category-icon" style={{ color: c.color, backgroundColor: `${c.color}16` }}><Icon name={c.icon} /></span><span><strong>{c.name}</strong>{c.archived && <small>В архиве</small>}</span><Icon name="right" size={16} /></button>)}</div><button className="button primary" onClick={() => open({ type: 'category' })}><Icon name="plus" />Своя категория</button></>;
}
export function CategoryForm({ categoryId }: { categoryId?: string }) {
  const { book, run, close, busy } = useApp(); const category = book.categories.find(c => c.id === categoryId); const [newId] = useState(id()); const [selectedIcon, setIcon] = useState(category?.icon ?? 'basket');
  return <Form busy={busy} onSubmit={async data => {
    const next: Category = { id: category?.id ?? newId, name: value(data, 'name'), type: (category?.type ?? value(data, 'type')) as Category['type'], color: value(data, 'color'), icon: selectedIcon, archived: data.has('archived') };
    await run({ type: 'category.save', category: next }, 'Категория сохранена'); close();
  }}><Field label="Название"><input name="name" defaultValue={category?.name} maxLength={120} required autoFocus /></Field>{!category && <Field label="Тип"><select name="type"><option value="expense">Расход</option><option value="income">Доход</option></select></Field>}<Field label="Иконка"><div className="icon-picker">{['basket', 'coffee', 'car', 'house', 'wifi', 'bag', 'heart', 'play', 'plane', 'gift', 'book', 'wallet', 'bank', 'briefcase', 'target', 'dots'].filter(name => name in icons).map(name => <button type="button" key={name} aria-label={`Иконка ${name}`} aria-pressed={selectedIcon === name} className={selectedIcon === name ? 'selected' : ''} onClick={() => setIcon(name)}><Icon name={name} /></button>)}</div></Field><ColorPicker initial={category?.color ?? '#b8d18b'} />{category && <Archive checked={category.archived} />}</Form>;
}

export function ScheduleForm({ scheduleId }: { scheduleId?: string }) {
  const { book, run, close, busy, date } = useApp(); const existing = book.schedules.find(s => s.id === scheduleId); const [newId] = useState(id()); const [kind, setKind] = useState<Schedule['kind']>(existing?.kind ?? 'expense');
  return <Form busy={busy} onSubmit={async data => {
    const dueDate = existing?.completed.length ? existing.dueDate : value(data, 'dueDate');
    const schedule: Schedule = { id: existing?.id ?? newId, name: value(data, 'name'), kind, amount: parseMoney(value(data, 'amount')), accountId: value(data, 'accountId'), categoryId: kind !== 'debt' ? value(data, 'categoryId') : undefined, debtId: kind === 'debt' ? value(data, 'debtId') : undefined, dueDate, repeat: existing?.completed.length ? existing.repeat : value(data, 'repeat') as Schedule['repeat'], dayOfMonth: Number(dueDate.slice(-2)), completed: existing?.completed ?? [], archived: data.has('archived') };
    await run({ type: 'schedule.save', schedule }, 'План сохранён'); close();
  }}>
    <Field label="Что планируем"><select value={kind} disabled={!!existing?.completed.length} onChange={e => setKind(e.target.value as Schedule['kind'])}><option value="expense">Обязательный платёж</option><option value="income">Ожидаемый доход</option><option value="debt">Возврат моего долга</option></select></Field>
    <Field label="Название"><input name="name" defaultValue={existing?.name} placeholder={kind === 'income' ? 'Например, зарплата' : 'Например, интернет дома'} required maxLength={120} /></Field>
    <Field label="Сумма, ₸"><input name="amount" inputMode="decimal" defaultValue={existing ? moneyInput(existing.amount) : ''} required /></Field>
    <div className="form-two"><AccountSelect initial={existing?.accountId} />{kind === 'debt' ? <Field label="Какой долг"><select name="debtId" defaultValue={existing?.debtId} required><option value="">Выберите долг</option>{book.debts.filter(d => !d.archived && d.direction === 'owe').map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field> : <CategorySelect key={kind} type={kind} initial={existing?.kind === kind ? existing.categoryId : undefined} />}</div>
    <div className="form-two"><Field label="Первая дата"><input type="date" name="dueDate" defaultValue={existing?.dueDate ?? date} disabled={!!existing?.completed.length} required /></Field><Field label="Повторение"><select name="repeat" defaultValue={existing?.repeat ?? 'monthly'} disabled={!!existing?.completed.length}><option value="monthly">Каждый месяц</option><option value="once">Без повторения</option></select></Field></div>
    <p className="hint-box"><Icon name="info" />План не меняет остатки. Фактическая запись появится после подтверждения. Для процентов по долгу добавьте отдельный расход.</p>
    {existing && <Archive checked={existing.archived} />}
  </Form>;
}
export function CompleteForm({ modal }: { modal: Modal }) {
  const { book, run, close, busy, date } = useApp(); const o = modal.occurrence!; const s = o.schedule; const [link, setLink] = useState('');
  const available = book.transactions.filter(t => t.kind === (s.kind === 'debt' ? 'debt_out' : s.kind) && (s.kind !== 'debt' || t.debtId === s.debtId) && !book.schedules.some(schedule => schedule.completed.some(c => c.transactionId === t.id)));
  return <Form busy={busy} submit={s.kind === 'income' ? 'Подтвердить получение' : 'Подтвердить оплату'} onSubmit={async data => { await run({ type: 'schedule.complete', scheduleId: s.id, dueDate: o.date, date: value(data, 'date') || date, amount: parseMoney(value(data, 'amount') || moneyInput(s.amount)), ...(link ? { transactionId: link } : {}) }, s.kind === 'income' ? 'Доход получен' : 'Платёж отмечен'); close(); }}>
    <div className="event-detail"><span className="category-icon"><Icon name={s.kind === 'income' ? 'down' : 'calendar'} /></span><div><h3>{s.name}</h3><p>По плану: {formatDate(o.date, { day: 'numeric', month: 'long' })}</p></div><Money book={book} value={s.amount} /></div>
    <Field label="Уже записали эту операцию?"><select value={link} onChange={e => setLink(e.target.value)}><option value="">Создать новую запись</option>{available.map(t => <option key={t.id} value={t.id}>{formatDate(t.date)} · {formatMoney(t.amount)} · {t.note || book.categories.find(c => c.id === t.categoryId)?.name}</option>)}</select></Field>
    {!link && <><Field label="Фактическая сумма, ₸"><input inputMode="decimal" name="amount" defaultValue={moneyInput(s.amount)} required /></Field><Field label="Фактическая дата"><input type="date" name="date" max={date} defaultValue={date} required /></Field><p className="small muted">Счёт: {book.accounts.find(a => a.id === s.accountId)?.name}</p></>}
    <p className="hint-box"><Icon name="info" />{link ? 'Выбранная запись будет связана с планом. Повторное движение денег не создаётся.' : 'Остаток счёта изменится, а этот платёж больше не будет резервироваться.'}</p>
  </Form>;
}

export function DebtsList() {
  const { book, open } = useApp(); const [direction, setDirection] = useState<'owe' | 'owed'>('owe');
  const selected = book.debts.filter(d => d.direction === direction && !d.archived);
  return <><div className="tabs"><button className={direction === 'owe' ? 'active' : ''} onClick={() => setDirection('owe')}>Я должен</button><button className={direction === 'owed' ? 'active' : ''} onClick={() => setDirection('owed')}>Мне должны</button></div><div className="detail-amount"><small>Осталось вернуть</small><Money book={book} value={selected.reduce((s, d) => s + debtBalance(book, d.id), 0)} /></div>{selected.length ? selected.map(d => <div className="debt-card" key={d.id}><div><button className="debt-title" onClick={() => open({ type: 'debt', id: d.id })}><strong>{d.name}</strong><Icon name="edit" size={15} /></button><Money book={book} value={debtBalance(book, d.id)} /></div><p>{d.dueDate ? `До ${formatDate(d.dueDate)}` : 'Без даты возврата'}{d.note && ` · ${d.note}`}</p>{debtBalance(book, d.id) > 0 ? <button className="button secondary" onClick={() => open({ type: 'repay', id: d.id })}>Частичный или полный возврат<Icon name="arrow" size={16} /></button> : <span className="positive small"><Icon name="success" size={16} />Долг закрыт</span>}</div>) : <Empty icon="bank" title={direction === 'owe' ? 'Вы никому не должны' : 'Здесь будут ваши займы'} text="Запишите сумму и дату. Частичные возвраты сохранятся в истории." />}<button className="button primary" onClick={() => open({ type: 'debt' })}><Icon name="plus" />Добавить долг</button></>;
}
export function DebtForm({ debtId }: { debtId?: string }) {
  const { book, run, close, busy, date } = useApp(); const existing = book.debts.find(d => d.id === debtId); const [newId] = useState(id());
  return <><Form busy={busy} onSubmit={async data => {
    await run({ type: 'debt.save', debt: { id: existing?.id ?? newId, name: value(data, 'name'), direction: existing?.direction ?? value(data, 'direction') as 'owe' | 'owed', opening: existing?.opening ?? parseMoney(value(data, 'amount')), dueDate: value(data, 'dueDate'), note: value(data, 'note'), archived: data.has('archived') }, moveMoney: !existing && data.has('moveMoney'), accountId: value(data, 'accountId') || undefined, date }, 'Долг сохранён'); close();
  }}><Field label="Кто кому должен"><select name="direction" defaultValue={existing?.direction ?? 'owe'} disabled={!!existing}><option value="owe">Я должен</option><option value="owed">Мне должны</option></select></Field><Field label="Имя человека или организации"><input name="name" defaultValue={existing?.name} required maxLength={120} autoFocus /></Field>{!existing ? <><Field label="Сумма долга, ₸"><input name="amount" inputMode="decimal" required /></Field><label className="checkbox-row"><input type="checkbox" name="moveMoney" /><span>Деньги переданы сегодня<small>Если это старый долг, оставьте выключенным</small></span></label><AccountSelect /></> : <div className="detail-amount"><small>Текущий остаток долга</small><Money book={book} value={debtBalance(book, existing.id)} /></div>}<Field label="Дата возврата" hint="Необязательно"><input type="date" name="dueDate" defaultValue={existing?.dueDate} /></Field><Field label="Комментарий"><input name="note" defaultValue={existing?.note} maxLength={500} /></Field>{existing && <Archive checked={existing.archived} />}</Form>{existing && book.transactions.some(t => t.debtId === existing.id) && <div className="debt-history"><h3>История движений</h3>{book.transactions.filter(t => t.debtId === existing.id).sort((a, b) => b.date.localeCompare(a.date)).map(t => <TransactionRow key={t.id} transaction={t} />)}</div>}</>;
}
export function RepayForm({ debtId }: { debtId: string }) {
  const { book, run, busy, close, date } = useApp(); const debt = book.debts.find(d => d.id === debtId)!;
  return <Form busy={busy} submit="Записать возврат" onSubmit={async data => { await run({ type: 'debt.repay', debtId, amount: parseMoney(value(data, 'amount')), accountId: value(data, 'accountId'), date: value(data, 'date') }, 'Возврат записан'); close(); }}><div className="hint-box"><Icon name="bank" /><span>{debt.name} · остаток {formatMoney(debtBalance(book, debtId), book.settings.hideAmounts)}</span></div><Field label="Сумма возврата, ₸"><input name="amount" inputMode="decimal" defaultValue={moneyInput(debtBalance(book, debtId))} required /></Field><AccountSelect label={debt.direction === 'owe' ? 'С какого счёта' : 'На какой счёт'} /><Field label="Дата"><input name="date" type="date" defaultValue={date} max={date} required /></Field><p className="small muted">Сумма изменит счёт и остаток долга. Обычные доходы и расходы не изменятся.</p></Form>;
}

export function AllowanceForm() {
  const { book, date, run, busy, close } = useApp(); const a = allowance(book, date);
  return <><div className={`detail-amount ${a.free < 0 ? 'negative' : ''}`}><small>{a.free < 0 ? 'Дефицит за период' : 'Можно потратить в день'}</small><Money book={book} value={a.free < 0 ? -a.free : a.daily} /></div><div className="calculation"><div><span>На участвующих счетах</span><Money book={book} value={a.balance} /></div><div><span>Предстоящие платежи</span><Money book={book} value={-a.reserved} /></div><div><span>Резерв на этих счетах</span><Money book={book} value={-a.reserve} /></div><div className="calculation-total"><strong>Свободно до {formatDate(a.horizon)}</strong><Money book={book} value={a.free} /></div><div><span>Дней расходов</span><strong>{a.days}</strong></div></div><Form busy={busy} onSubmit={async data => { await run({ type: 'settings.update', settings: { horizon: value(data, 'horizon') as 'income' | 'month', reserve: parseMoney(value(data, 'reserve') || '0') } }, 'Расчёт обновлён'); close(); }}><Field label="Период расчёта"><select name="horizon" defaultValue={book.settings.horizon}><option value="income">До следующего дохода</option><option value="month">До конца месяца</option></select></Field><Field label="Резерв, ₸" hint="Только деньги на участвующих счетах. Накопительные счета, исключённые из расчёта, уже не учитываются."><input name="reserve" inputMode="decimal" defaultValue={moneyInput(book.settings.reserve)} /></Field>{book.settings.horizon === 'income' && !a.nextIncome && <p className="hint-box"><Icon name="info" />Будущий доход не задан. Пока используем конец месяца.</p>}<p className="small muted">Неполученные доходы не прибавляются к остатку. Лимиты бюджета и категорий действуют отдельно.</p></Form></>;
}

export function SettingsForm() {
  const { book, run, perform, busy, close, open } = useApp();
  const [reminders, setReminders] = useState(book.settings.reminders); const [weekly, setWeekly] = useState(book.settings.weeklyReport); const [alerts, setAlerts] = useState(book.settings.limitAlerts);
  const enableWrite = async () => {
    if (isDemo) return;
    const app = telegram(); if (!app?.requestWriteAccess) throw new Error('Включите уведомления в Telegram');
    const allowed = await new Promise<boolean>(resolve => app.requestWriteAccess!(resolve));
    if (!allowed) throw new Error('Для уведомлений разрешите боту отправлять сообщения');
  };
  return <><div className="settings-mode"><Icon name={isDemo ? 'device' : 'shield'} /><div><strong>{isDemo ? 'Локальный режим' : 'Ваш бюджет в Supabase'}</strong><p>{isDemo ? 'Данные хранятся в этом браузере. Пример можно заменить своим бюджетом.' : 'Вход через Telegram, доступ только к вашим данным.'}</p></div></div>
    <Form busy={busy} onSubmit={async data => {
      if (reminders || weekly || alerts) { if (!isDemo) await enableWrite(); }
      await run({ type: 'settings.update', settings: { name: value(data, 'name'), timezone: value(data, 'timezone'), reminderTime: value(data, 'reminderTime'), reminders, weeklyReport: weekly, limitAlerts: alerts } }, 'Настройки сохранены'); close();
    }}><Field label="Название бюджета"><input name="name" defaultValue={book.settings.name} required maxLength={80} /></Field><h3>Внешний вид</h3><div className="theme-options">{(['auto', 'light', 'dark'] as const).map(theme => <button type="button" key={theme} className={book.settings.theme === theme ? 'active' : ''} onClick={() => perform({ type: 'settings.update', settings: { theme } })}><Icon name={theme === 'auto' ? 'device' : theme === 'light' ? 'sun' : 'moon'} /><span>{theme === 'auto' ? 'Как в Telegram' : theme === 'light' ? 'Светлая' : 'Тёмная'}</span></button>)}</div>
      <Toggle label="Скрывать суммы" checked={book.settings.hideAmounts} onChange={hideAmounts => perform({ type: 'settings.update', settings: { hideAmounts } })} />
      <Toggle label="Вибрация при действиях" description="При поддержке Telegram-клиента" checked={book.settings.haptics} onChange={haptics => perform({ type: 'settings.update', settings: { haptics } })} />
      <h3>Уведомления</h3><Toggle label="Платежи и возвраты долгов" checked={reminders} onChange={setReminders} /><Toggle label="Приближение к лимитам" checked={alerts} onChange={setAlerts} /><Toggle label="Недельный отчёт" description="По понедельникам" checked={weekly} onChange={setWeekly} />
      {isDemo && <p className="hint-box"><Icon name="info" />В локальном режиме бот не отправляет сообщения. Эти настройки начнут работать после подключения Supabase и Telegram.</p>}
      <div className="form-two"><Field label="Время уведомлений"><input name="reminderTime" type="time" defaultValue={book.settings.reminderTime} required /></Field><Field label="Часовой пояс"><input name="timezone" defaultValue={book.settings.timezone} placeholder="Asia/Almaty" required /></Field></div>
    </Form><div className="settings-links"><button onClick={() => open({ type: 'accounts' })}><Icon name="wallet" />Счета<Icon name="right" /></button><button onClick={() => open({ type: 'categories' })}><Icon name="sliders" />Категории<Icon name="right" /></button><button onClick={() => open({ type: 'export' })}><Icon name="download" />Экспорт CSV<Icon name="right" /></button>{isDemo && <button onClick={() => open({ type: 'demoReset' })}><Icon name="undo" />Загрузить демонстрационный пример<Icon name="right" /></button>}<button className="negative" onClick={() => open({ type: 'reset' })}><Icon name="trash" />Удалить финансовые данные<Icon name="right" /></button></div></>;
}

export function OnboardForm() {
  const { book, run, busy, close, navigate } = useApp();
  return <Form busy={busy} submit="Создать мой бюджет" onSubmit={async data => {
    const command: Command = { type: 'onboard', name: value(data, 'name'), accountName: value(data, 'accountName'), opening: parseMoney(value(data, 'opening')) };
    if (book.onboarded) await run({ type: 'reset' });
    await run(command, 'Ваш бюджет готов'); close(); navigate('home');
  }}><p className="muted">Начните с одного счёта. Доходы, платежи и лимиты можно настроить позже.</p>{book.onboarded && <p className="hint-box"><Icon name="info" />Текущие демонстрационные записи будут заменены вашим новым бюджетом.</p>}<Field label="Название бюджета"><input name="name" defaultValue="Мой бюджет" maxLength={80} required /></Field><Field label="Первый счёт"><input name="accountName" defaultValue="Kaspi Gold" maxLength={120} required /></Field><Field label="Сколько на счёте сейчас, ₸"><input name="opening" inputMode="decimal" placeholder="Например, 150000" required /></Field></Form>;
}
export function ResetForm() {
  const { run, busy, close } = useApp();
  return <Form busy={busy} submit="Удалить данные" onSubmit={async data => { if (value(data, 'confirm') !== 'УДАЛИТЬ') throw new Error('Введите слово УДАЛИТЬ'); await run({ type: 'reset' }, 'Финансовые данные удалены'); close(); }}><p className="hint-box"><Icon name="warning" />Будут удалены счета, операции, планы, долги, категории и лимиты. Перед удалением можно сделать экспорт.</p><Field label="Введите УДАЛИТЬ для подтверждения"><input name="confirm" required autoComplete="off" /></Field></Form>;
}
export function DemoResetForm() {
  const { resetDemo, busy, close } = useApp();
  return <Form busy={busy} submit="Заменить данные примером" onSubmit={async data => { if (value(data, 'confirm') !== 'ПРИМЕР') throw new Error('Введите слово ПРИМЕР'); await resetDemo(); close(); }}><p className="hint-box"><Icon name="warning" />Текущие локальные записи будут заменены демонстрационным бюджетом. При необходимости сначала экспортируйте операции.</p><Field label="Введите ПРИМЕР для подтверждения"><input name="confirm" required autoComplete="off" /></Field></Form>;
}
export function ExportForm() {
  const { book, date, busy, close, filters, notify } = useApp();
  return <Form busy={busy} submit="Скачать CSV" onSubmit={async data => {
    const from = value(data, 'from'), to = value(data, 'to'); if (from > to) throw new Error('Начальная дата должна быть раньше конечной');
    const blob = new Blob([exportCsv(book, from, to)], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `tiyn-${from}-${to}.csv`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30000); notify('CSV подготовлен к скачиванию'); close();
  }}><p className="muted">Все операции за период: даты, типы, суммы, категории, счета и комментарии. Скрытие сумм на экране не меняет экспорт.</p><div className="form-two"><Field label="С даты"><input name="from" type="date" defaultValue={filters.from || `${monthOf(date)}-01`} required /></Field><Field label="По дату"><input name="to" type="date" max={date} defaultValue={filters.to || date} required /></Field></div></Form>;
}

export function BotForm() {
  const { book, date, run, busy, close, open } = useApp(); const [text, setText] = useState(''); const [draft, setDraft] = useState<Omit<Transaction, 'createdAt'> | null>(null); const [error, setError] = useState('');
  return <><div className="bot-intro"><span className="empty-icon"><Icon name="telegram" size={28} /></span><p>Одна строка вместо нескольких полей.<br />Попробуйте, как будет понимать вас бот.</p></div><form className="form" onSubmit={e => { e.preventDefault(); try { const parsed = parseText(text, book, date); if (parsed.needsAccount) throw new Error('Сначала добавьте счёт'); setDraft(parsed.draft); setError(''); } catch (e) { setError((e as Error).message); setDraft(null); } }}><Field label="Сообщение"><input value={text} onChange={e => setText(e.target.value)} placeholder="кофе 1800" autoFocus maxLength={500} required /></Field><div className="example-chips">{['кофе 1800', 'такси 2500 вчера', 'доход 350000 зарплата'].map(example => <button type="button" key={example} onClick={() => { setText(example); setDraft(null); }}>{example}</button>)}</div>{error && <p className="form-error" role="alert">{error}</p>}<button className="button secondary" type="submit"><Icon name="telegram" />Разобрать сообщение</button></form>{draft && <Form busy={busy} submit="Записать операцию" onSubmit={async data => { await run({ type: 'transaction.save', transaction: { ...draft, categoryId: value(data, 'categoryId') } }, 'Операция добавлена'); close(); }}><div className="parse-result"><span>{draft.kind === 'expense' ? 'Расход' : 'Доход'} · {formatDate(draft.date)}</span><Money book={book} value={draft.amount} /><small>{book.accounts.find(a => a.id === draft.accountId)?.name} · {draft.note}</small></div>{!draft.categoryId && <p className="small muted">Категорию не удалось определить однозначно. Выберите её:</p>}<CategorySelect key={draft.id} type={draft.kind === 'income' ? 'income' : 'expense'} initial={draft.categoryId} /><button type="button" className="text-button" onClick={() => open({ type: 'transaction', draft })}>Открыть полную форму<Icon name="right" size={15} /></button></Form>}{!isDemo && import.meta.env.VITE_TELEGRAM_BOT_USERNAME && <a className="button secondary bot-link" href={`https://t.me/${import.meta.env.VITE_TELEGRAM_BOT_USERNAME.replace('@', '')}`} target="_blank" rel="noreferrer"><Icon name="telegram" />Открыть Telegram-бота</a>}</>;
}
