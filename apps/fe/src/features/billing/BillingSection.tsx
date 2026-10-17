import { PLANS, type BillingSummary, type PlanDefinition } from '@repo/shared';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { formatDate, useT, type TFunction } from '../../i18n';
import { usd } from '../../lib/format';
import { errorMessage } from '../../lib/error-message';
import { onExternalLinkClick } from '../../lib/open-external';
import { qk } from '../../lib/query-keys';
import { useNotify } from '../settings/settings.api';
import { useSession } from '../workspace/workspace.api';
import { useBilling, useCheckout, usePortal } from './billing.api';
import {
  barPct,
  meterOf,
  planActionKind,
  planCardState,
  RESOURCES,
  salesMailto,
  type PlanCardState,
} from './billing.logic';

const route = getRouteApi('/_app/settings/$section');
const SALES_EMAIL = import.meta.env.VITE_SALES_EMAIL;

// Numeric day/month/year in the active locale (vi-VN: 17/10/2026, en-US: 10/17/2026).
const dateOf = (iso: string) =>
  formatDate(iso, { day: '2-digit', month: '2-digit', year: 'numeric' });

export function BillingSection() {
  const t = useT();
  const notify = useNotify();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { checkout } = route.useSearch();
  const { data, error, refetch } = useBilling();

  // Back from Stripe: tell the user, refresh the plan and drop the query.
  useEffect(() => {
    if (!checkout) return;
    // Only the error tone differs visually; a canceled checkout is not a success.
    notify(
      t(checkout === 'success' ? 'billing.checkoutSuccess' : 'billing.checkoutCancel'),
      checkout !== 'success',
    );
    if (checkout === 'success') void qc.invalidateQueries({ queryKey: qk.billing });
    void navigate({
      to: '/settings/$section',
      params: { section: 'billing' },
      search: {},
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkout]);

  if (error)
    return (
      <div className="set-empty">
        {errorMessage(error, t, 'billing.loadFailed')}{' '}
        <button className="btn sm" onClick={() => void refetch()}>
          {t('common.retry')}
        </button>
      </div>
    );
  if (!data) return null;
  return (
    <div className="set-stack wide">
      <PlanBox b={data} />
      <UsageBox b={data} />
      <MonthBox b={data} />
      <PlansBox b={data} />
    </div>
  );
}

function PlanBox({ b }: { b: BillingSummary }) {
  const t = useT();
  const isOwner = useSession().data?.user.role === 'owner';
  const portal = usePortal();
  const sub = b.subscription;
  const pastDue = sub?.status === 'past_due';
  const statusKey = {
    active: 'billing.statusActive',
    trialing: 'billing.statusTrialing',
    past_due: 'billing.statusPastDue',
    canceled: 'billing.statusCanceled',
    incomplete: 'billing.statusIncomplete',
  } as const;
  return (
    <div className="box set-box wide">
      <div className="set-head">
        <h4>{t('billing.planTitle')}</h4>
        {isOwner && b.checkoutAvailable && sub && (
          <button className="btn" disabled={portal.isPending} onClick={() => portal.mutate()}>
            {t('billing.manage')}
          </button>
        )}
      </div>
      <div className="bill-plan">
        <b>{t('billing.planName', { plan: t(`billing.plan.${b.plan}`) })}</b>
        {sub?.status && (
          <span className={`bill-status ${pastDue ? 'bad' : ''}`}>{t(statusKey[sub.status])}</span>
        )}
      </div>
      {sub?.currentPeriodEnd && (
        <p className="sub" style={{ margin: '8px 0 0' }}>
          {sub.cancelAtPeriodEnd
            ? t('billing.endsOn', { date: dateOf(sub.currentPeriodEnd) })
            : t('billing.renews', { date: dateOf(sub.currentPeriodEnd) })}
        </p>
      )}
      {pastDue && (
        <div className="err-line" role="alert">
          {t('billing.pastDue')}
        </div>
      )}
    </div>
  );
}

function UsageBox({ b }: { b: BillingSummary }) {
  const t = useT();
  const notes = {
    seats: 'billing.seatsNote',
    agents: 'billing.demoItemsNote',
    computers: 'billing.computersNote',
  } as const;
  return (
    <div className="box set-box wide">
      <h4>{t('billing.usageTitle')}</h4>
      <p className="sub">{t('billing.usageLead')}</p>
      <div className="meters">
        {RESOURCES.map((r) => {
          const m = meterOf(b.usage[r], b.limits[r]);
          const note = notes[r];
          return (
            <div key={r} className={`meter ${m.level}`}>
              <div className="meter-top">
                <span>{t(`billing.resourceTitle.${r}`)}</span>
                <b>
                  {m.used} / {m.limit}
                </b>
              </div>
              <div
                className="meter-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={m.limit}
                aria-valuenow={m.used}
                aria-label={t(`billing.resourceTitle.${r}`)}
              >
                <i style={{ width: `${m.pct}%` }} />
              </div>
              {note && <div className="meter-note">{t(note)}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthBox({ b }: { b: BillingSummary }) {
  const t = useT();
  const peak = Math.max(...b.byDay.map((d) => d.costUsd), 0);
  const end = new Date(Date.parse(b.period.end) - 1).toISOString();
  return (
    <div className="box set-box wide">
      <h4>{t('billing.monthTitle')}</h4>
      <p className="sub">
        {t('billing.monthLead', { start: dateOf(b.period.start), end: dateOf(end) })}
      </p>
      <div className="bill-stats">
        <div>
          <span>{t('billing.cost')}</span>
          <b>{usd(b.costUsd)}</b>
        </div>
        <div>
          <span>{t('billing.runs')}</span>
          <b>{b.runs}</b>
        </div>
      </div>
      {b.runs === 0 && b.byAgent.length === 0 ? (
        <div className="set-empty">{t('billing.noUsage')}</div>
      ) : (
        <>
          <h5 className="bill-h">{t('billing.byDay')}</h5>
          <div className="bill-bars" role="img" aria-label={t('billing.byDay')}>
            {b.byDay.map((d) => (
              <div
                key={d.date}
                className="bill-bar"
                title={`${d.date}: ${usd(d.costUsd)} · ${d.runs}`}
              >
                <i style={{ height: `${barPct(d.costUsd, peak)}%` }} />
              </div>
            ))}
          </div>
          <h5 className="bill-h">{t('billing.byAgent')}</h5>
          <table className="dtable">
            <thead>
              <tr>
                <th>{t('billing.agent')}</th>
                <th style={{ textAlign: 'right' }}>{t('billing.runs')}</th>
                <th style={{ textAlign: 'right' }}>{t('billing.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {b.byAgent.map((a) => (
                <tr key={a.agentId}>
                  <td>{a.name}</td>
                  <td style={{ textAlign: 'right' }}>{a.runs}</td>
                  <td style={{ textAlign: 'right' }}>{usd(a.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function priceLabel(p: PlanDefinition, t: TFunction): string {
  if (p.priceMonthlyUsd === 0) return t('billing.free');
  return `$${p.priceMonthlyUsd}${t(p.perSeat ? 'billing.perSeatMonth' : 'billing.perMonth')}`;
}

function PlansBox({ b }: { b: BillingSummary }) {
  const t = useT();
  const isOwner = useSession().data?.user.role === 'owner';
  const checkout = useCheckout();
  const portal = usePortal();
  const busy = checkout.isPending || portal.isPending;

  const act = (plan: PlanDefinition, state: PlanCardState) => {
    if (state !== 'upgrade' && state !== 'downgrade') return;
    if (planActionKind(plan, b.subscription) === 'portal' || plan.id === 'free') portal.mutate();
    else checkout.mutate({ plan: plan.id });
  };

  return (
    <div className="box set-box wide">
      <h4>{t('billing.plansTitle')}</h4>
      {!isOwner && <p className="sub">{t('billing.onlyOwner')}</p>}
      {isOwner && !b.checkoutAvailable && <p className="sub">{t('billing.unavailable')}</p>}
      {checkout.isSuccess && (
        <p className="sub" role="status">
          {t('billing.checkoutHint')}
        </p>
      )}
      <div className="plan-cards">
        {PLANS.map((p) => {
          const state = planCardState(p, b.plan, b.checkoutAvailable);
          const mail = salesMailto(SALES_EMAIL, p.id);
          const name = t(`billing.plan.${p.id}`);
          return (
            <div key={p.id} className={`plan-card ${state === 'current' ? 'on' : ''}`}>
              <div className="plan-name">
                {name}
                {state === 'current' && (
                  <span className="role-badge owner">{t('billing.current')}</span>
                )}
              </div>
              <div className="plan-price">{priceLabel(p, t)}</div>
              <ul>
                <li>{t('billing.featureSeats', { n: p.seats })}</li>
                <li>{t('billing.featureAgents', { n: p.agents })}</li>
                <li>{t('billing.featureComputers', { n: p.computers })}</li>
              </ul>
              {state === 'contact'
                ? mail && (
                    <a className="btn" href={mail} onClick={(e) => onExternalLinkClick(e, mail)}>
                      {t('billing.contactSales')}
                    </a>
                  )
                : state !== 'current' && (
                    <button
                      className={`btn ${state === 'upgrade' ? 'primary' : ''}`}
                      disabled={!isOwner || busy}
                      onClick={() => act(p, state)}
                    >
                      {t(state === 'upgrade' ? 'billing.upgradeTo' : 'billing.switchTo', {
                        plan: name,
                      })}
                    </button>
                  )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
