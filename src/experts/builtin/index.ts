import type { Expert } from "../types.js";
import { CUSTOMER_EXPERTS } from "./departments/customer.js";
import { DATA_EXPERTS } from "./departments/data.js";
import { DESIGN_EXPERTS } from "./departments/design.js";
import { ENGINEERING_EXPERTS } from "./departments/engineering.js";
import { FINANCE_EXPERTS } from "./departments/finance.js";
import { LEADERSHIP_EXPERTS } from "./departments/leadership.js";
import { LEGAL_EXPERTS } from "./departments/legal.js";
import { MARKETING_EXPERTS } from "./departments/marketing.js";
import { OPERATIONS_EXPERTS } from "./departments/operations.js";
import { PEOPLE_EXPERTS } from "./departments/people.js";
import { PRODUCT_EXPERTS } from "./departments/product.js";
import { RESEARCH_EXPERTS } from "./departments/research.js";
import { SALES_EXPERTS } from "./departments/sales.js";

/**
 * Aggregated bundled roster — the full "starter company" Alien ships with.
 * ~80 experts spread across 13 departments. Add a new department by
 * authoring a file under ./departments and including it here.
 */
export const BUNDLED_EXPERTS: readonly Expert[] = [
  ...LEADERSHIP_EXPERTS,
  ...PRODUCT_EXPERTS,
  ...ENGINEERING_EXPERTS,
  ...DESIGN_EXPERTS,
  ...RESEARCH_EXPERTS,
  ...DATA_EXPERTS,
  ...MARKETING_EXPERTS,
  ...SALES_EXPERTS,
  ...CUSTOMER_EXPERTS,
  ...OPERATIONS_EXPERTS,
  ...FINANCE_EXPERTS,
  ...PEOPLE_EXPERTS,
  ...LEGAL_EXPERTS,
];
