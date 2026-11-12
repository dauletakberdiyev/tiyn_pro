import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactNode, type FormEvent } from 'react';
import {
  House, ListBullets, ChartBar, Wallet, Plus, ArrowUpRight, ArrowDownLeft, ArrowsLeftRight,
  GearSix, Eye, EyeSlash, X, CaretRight, CaretLeft, ArrowRight, Check, WarningCircle,
  ShoppingCart, Coffee, Car, WifiHigh, ShoppingBag, Heart, Play, AirplaneTilt, Gift,
  BookOpen, Bank, DotsThree, Briefcase, CalendarBlank, DownloadSimple, Trash, PencilSimple,
  ArrowCounterClockwise, SignOut, Bell, Coins, SlidersHorizontal, MagnifyingGlass, Info,
  Target, Copy, PaperPlaneTilt, Sun, Moon, DeviceMobile, CircleNotch, CheckCircle, ShieldCheck,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { formatMoney, type Book } from '../supabase/functions/_shared/domain.ts';
import { telegram } from './telegram';
export const icons: Record<string, PhosphorIcon> = {
  home: House, list: ListBullets, chart: ChartBar, wallet: Wallet, plus: Plus,
  up: ArrowUpRight, down: ArrowDownLeft, transfer: ArrowsLeftRight, settings: GearSix,
  eye: Eye, hidden: EyeSlash, close: X, right: CaretRight, left: CaretLeft, arrow: ArrowRight,
  check: Check, warning: WarningCircle, basket: ShoppingCart, coffee: Coffee, car: Car,
  house: House, wifi: WifiHigh, bag: ShoppingBag, heart: Heart, play: Play, plane: AirplaneTilt,
  gift: Gift, book: BookOpen, bank: Bank, dots: DotsThree, briefcase: Briefcase, calendar: CalendarBlank,
  download: DownloadSimple, trash: Trash, edit: PencilSimple, undo: ArrowCounterClockwise,
  logout: SignOut, bell: Bell, coins: Coins, sliders: SlidersHorizontal, search: MagnifyingGlass,
  info: Info, target: Target, copy: Copy, telegram: PaperPlaneTilt, sun: Sun, moon: Moon,
  device: DeviceMobile, loading: CircleNotch, success: CheckCircle, shield: ShieldCheck,
};
export function Icon({ name, size = 20, className = '' }: { name: string; size?: number; className?: string }) {
  const Component = icons[name] ?? DotsThree; return <Component size={size} weight="regular" className={className} aria-hidden="true" />;
}
export function Money({ value, book, className = '' }: { value: number; book: Book; className?: string }) {
  const long = !book.settings.hideAmounts && Math.abs(value) >= 1_000_000_000;
  return <span className={`money ${long ? 'money-long' : ''} ${className}`}>{formatMoney(value, book.settings.hideAmounts)}</span>;
}
export function IconButton({ icon, label, onClick, className = '', disabled = false }: { icon: string; label: string; onClick: () => void; className?: string; disabled?: boolean }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}><Icon name={icon} /></button>;
}
export function Empty({ icon = 'list', title, text, action }: { icon?: string; title: string; text?: string; action?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon name={icon} size={30} /></span><h3>{title}</h3>{text && <p>{text}</p>}{action}</div>;
}
export function SectionTitle({ title, aside }: { title: string; aside?: ReactNode }) {
  return <div className="section-title"><h2>{title}</h2>{aside}</div>;
}
export function Sheet({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = dialog.current!; d.showModal(); document.body.style.overflow = 'hidden';
    const app = telegram(); app?.BackButton.show(); app?.BackButton.onClick(onClose);
    return () => { document.body.style.overflow = ''; app?.BackButton.offClick(onClose); app?.BackButton.hide(); };
  }, [onClose]);
  return <dialog className="sheet" aria-labelledby={titleId} ref={dialog} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="sheet-inner"><div className="sheet-header"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton icon="close" label="Закрыть" onClick={onClose} /></div>{children}</div>
  </dialog>;
}
export function Form({ children, onSubmit, submit = 'Сохранить', busy, footer }: { children: ReactNode; onSubmit: (data: FormData) => Promise<void>; submit?: string; busy: boolean; footer?: ReactNode }) {
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const handle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (submitting.current) return; submitting.current = true;
    const data = new FormData(event.currentTarget); setError('');
    try { await onSubmit(data); }
    catch (e) { setError(e instanceof Error ? (e.message.startsWith('[') ? 'Проверьте заполнение полей и сумму' : e.message) : 'Не удалось сохранить'); }
    finally { submitting.current = false; }
  };
  return <form className="form" onSubmit={handle}>{children}{error && <div className="form-error" role="alert"><Icon name="warning" />{error}</div>}<div className="form-footer"><button className="button primary" type="submit" disabled={busy}>{busy ? 'Сохраняем…' : submit}<Icon name={busy ? 'loading' : 'check'} /></button>{footer}</div></form>;
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const controlId = useId(); const hintId = `${controlId}-hint`;
  const native = isValidElement(children) && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type);
  const control = native ? cloneElement(children as React.ReactElement<Record<string, unknown>>, { id: controlId, ...(hint ? { 'aria-describedby': hintId } : {}) }) : children;
  return <div className="field">{native ? <label className="field-label" htmlFor={controlId}>{label}</label> : <span>{label}</span>}{control}{hint && <small id={hintId}>{hint}</small>}</div>;
}
export function Toggle({ label, description, checked, onChange, disabled = false }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="toggle-row"><span><strong>{label}</strong>{description && <small>{description}</small>}</span><input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} disabled={disabled} /><span className="switch" aria-hidden="true" /></label>;
}
