import React from 'react';
import { useI18n } from '../i18n';

export type BudgetType = 'tokens' | 'usd';
export type BudgetCadence = 'daily' | 'weekly' | 'monthly' | 'one-shot';

export interface BudgetLimitControlProps {
  limit: number;
  type: BudgetType;
  cadence: BudgetCadence;
  onChange: (updates: {
    limit: number;
    type: BudgetType;
    cadence: BudgetCadence;
  }) => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
  idPrefix?: string;
}

export const BudgetLimitControl: React.FC<BudgetLimitControlProps> = ({
  limit,
  type,
  cadence,
  onChange,
  disabled = false,
  label,
  hint,
  idPrefix = 'budget',
}) => {
  const { t } = useI18n();

  const currentCombination = `${type}:${cadence}`;

  const handleCombinationChange = (combo: string) => {
    const [newType, newCadence] = combo.split(':') as [BudgetType, BudgetCadence];
    onChange({
      limit,
      type: newType,
      cadence: newCadence,
    });
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const num = val === '' ? 0 : Math.max(0, Number(val));
    onChange({
      limit: num,
      type,
      cadence,
    });
  };

  const cadenceLabel =
    cadence === 'daily'
      ? t('budget.cadence_daily')
      : cadence === 'weekly'
      ? t('budget.cadence_weekly')
      : cadence === 'monthly'
      ? t('budget.cadence_monthly')
      : t('budget.cadence_oneshot');

  return (
    <div className="ds-field flex flex-col gap-1.5">
      <label htmlFor={`${idPrefix}-amount`} className="ds-label">
        {label || t('budget.label')}
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <input
            id={`${idPrefix}-amount`}
            type="number"
            min="0"
            step={type === 'tokens' ? '1000' : '0.01'}
            disabled={disabled}
            placeholder={t('budget.unlimited_placeholder')}
            value={limit === 0 ? '' : limit}
            onChange={handleAmountChange}
            className="ds-input text-xs font-mono w-full"
            aria-label={t('budget.amount_label')}
          />
        </div>

        <div>
          <select
            id={`${idPrefix}-unit-cadence`}
            disabled={disabled}
            value={currentCombination}
            onChange={(e) => handleCombinationChange(e.target.value)}
            className="ds-input text-xs w-full cursor-pointer"
            aria-label={t('budget.unit_cadence_label')}
          >
            <option value="tokens:daily">{t('budget.opt_tokens_daily')}</option>
            <option value="tokens:weekly">{t('budget.opt_tokens_weekly')}</option>
            <option value="tokens:monthly">{t('budget.opt_tokens_monthly')}</option>
            <option value="tokens:one-shot">{t('budget.opt_tokens_oneshot')}</option>
            <option value="usd:daily">{t('budget.opt_usd_daily')}</option>
            <option value="usd:weekly">{t('budget.opt_usd_weekly')}</option>
            <option value="usd:monthly">{t('budget.opt_usd_monthly')}</option>
            <option value="usd:one-shot">{t('budget.opt_usd_oneshot')}</option>
          </select>
        </div>
      </div>

      <div className="text-[11px] text-muted leading-tight">
        {hint ? (
          hint
        ) : limit <= 0 ? (
          t('budget.summary_unlimited')
        ) : type === 'tokens' ? (
          t('budget.summary_tokens')
            .replace('{limit}', limit.toLocaleString())
            .replace('{cadence}', cadenceLabel)
        ) : (
          t('budget.summary_usd')
            .replace('{limit}', limit.toFixed(2))
            .replace('{cadence}', cadenceLabel)
        )}
      </div>
    </div>
  );
};
