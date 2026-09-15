import { useMemo, useState } from 'react';
import { Shell } from '../components/Shell';
import { moneyFromDollars } from '../format';

const DEFAULTS = {
  monthlyRent: 1800,
  unitCount: 40,
  turnoverYears: 2,
  currentLeasingFee: 1800,
  currentConcession: 900,
  dwelListingFee: 140,
  dwelIncentivePercent: 20,
  screeningCredit: 0,
  capRatePercent: 5.5,
};

export function CalculatorPage() {
  const [monthlyRent, setMonthlyRent] = useState(DEFAULTS.monthlyRent);
  const [unitCount, setUnitCount] = useState(DEFAULTS.unitCount);
  const [turnoverYears, setTurnoverYears] = useState(DEFAULTS.turnoverYears);
  const [currentLeasingFee, setCurrentLeasingFee] = useState(DEFAULTS.currentLeasingFee);
  const [currentConcession, setCurrentConcession] = useState(DEFAULTS.currentConcession);
  const [dwelListingFee, setDwelListingFee] = useState(DEFAULTS.dwelListingFee);
  const [dwelIncentivePercent, setDwelIncentivePercent] = useState(DEFAULTS.dwelIncentivePercent);
  const [screeningCredit, setScreeningCredit] = useState(DEFAULTS.screeningCredit);
  const [capRatePercent, setCapRatePercent] = useState(DEFAULTS.capRatePercent);

  const math = useMemo(() => {
    const incentive = monthlyRent * (dwelIncentivePercent / 100);
    const traditional = currentLeasingFee + currentConcession;
    const dwelCost = dwelListingFee + incentive - screeningCredit;
    const savings = traditional - dwelCost;
    const annualTurnovers = turnoverYears > 0 ? unitCount / turnoverYears : 0;
    const annualNoi = savings * annualTurnovers;
    const cap = capRatePercent / 100;
    const valueCreated = cap > 0 ? annualNoi / cap : 0;
    return { incentive, traditional, dwelCost, savings, annualTurnovers, annualNoi, valueCreated };
  }, [
    monthlyRent,
    unitCount,
    turnoverYears,
    currentLeasingFee,
    currentConcession,
    dwelListingFee,
    dwelIncentivePercent,
    screeningCredit,
    capRatePercent,
  ]);

  return (
    <Shell>
      <div className="stack">
        <div>
          <h1>NOI Impact Calculator</h1>
          <p>
            Transparent turnover math for owners and operators. Every assumption is editable — adjust
            inputs to your building.
          </p>
        </div>

        <div className="callout">
          <strong>Assumptions are editable</strong>
          Prefills are illustrative starting points from internal modeling (including a mid-tier
          listing fee and a 20% renter incentive). They are not contractual pricing.
        </div>

        <div className="calc-layout">
          <div className="panel">
            <div className="form-grid two">
              <label>
                Monthly rent ($)
                <input type="number" min={0} value={monthlyRent} onChange={(e) => setMonthlyRent(Number(e.target.value))} />
              </label>
              <label>
                Unit count
                <input type="number" min={0} value={unitCount} onChange={(e) => setUnitCount(Number(e.target.value))} />
              </label>
              <label>
                Turnover frequency (years)
                <span className="hint">Default every 2 years</span>
                <input type="number" min={0.25} step={0.25} value={turnoverYears} onChange={(e) => setTurnoverYears(Number(e.target.value))} />
              </label>
              <label>
                Current leasing / broker fee ($)
                <input type="number" min={0} value={currentLeasingFee} onChange={(e) => setCurrentLeasingFee(Number(e.target.value))} />
              </label>
              <label>
                Current concession ($)
                <span className="hint">Your existing cost — use $0 if none</span>
                <input type="number" min={0} value={currentConcession} onChange={(e) => setCurrentConcession(Number(e.target.value))} />
              </label>
              <label>
                dwel.20 listing fee ($)
                <input type="number" min={0} value={dwelListingFee} onChange={(e) => setDwelListingFee(Number(e.target.value))} />
              </label>
              <label>
                Tenant incentive (%)
                <span className="hint">Percent of monthly rent</span>
                <input type="number" min={0} step={0.1} value={dwelIncentivePercent} onChange={(e) => setDwelIncentivePercent(Number(e.target.value))} />
              </label>
              <label>
                Screening credit / rebate ($)
                <input type="number" min={0} value={screeningCredit} onChange={(e) => setScreeningCredit(Number(e.target.value))} />
              </label>
              <label>
                Cap rate (%)
                <span className="hint">Illustrative default 5.5% — enter yours</span>
                <input type="number" min={0.1} step={0.1} value={capRatePercent} onChange={(e) => setCapRatePercent(Number(e.target.value))} />
              </label>
            </div>
          </div>

          <div className="math">
            <h3>Formula steps</h3>
            <div className="math-row">
              <span>traditional_turnover_cost</span>
              <span>{moneyFromDollars(math.traditional)}</span>
            </div>
            <div className="math-row">
              <span>dwel_turnover_cost</span>
              <span>{moneyFromDollars(math.dwelCost)}</span>
            </div>
            <div className="math-row">
              <span>savings_per_turnover</span>
              <span>{moneyFromDollars(math.savings)}</span>
            </div>
            <div className="math-row">
              <span>annual_turnovers</span>
              <span>{math.annualTurnovers.toFixed(2)}</span>
            </div>
            <div className="math-row">
              <span>annual_noi_gain</span>
              <span>{moneyFromDollars(math.annualNoi)}</span>
            </div>
            <div className="math-row">
              <span>property_value_created</span>
              <span>{moneyFromDollars(math.valueCreated)}</span>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
