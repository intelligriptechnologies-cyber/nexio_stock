import { Link } from "react-router-dom";
import { AuthShell } from "../components/AuthShell";

const SECTIONS: Array<{ heading: string; paragraphs: string[] }> = [
  {
    heading: "1. Scope of Use",
    paragraphs: [
      "Nexio Hyper is provided as a retail operations and inventory management platform for authorized business use. By accessing or using the product, you confirm that you are acting for a business or organization permitted to use the service and that you will use it only for legitimate operational purposes.",
      "You are responsible for maintaining the confidentiality of account credentials, terminal access, device access, and any approval authority assigned to your team. You are also responsible for ensuring that the shop, staff, catalog, billing, stock, and other operational data entered into Nexio Hyper is accurate and kept reasonably up to date.",
      "You must use Nexio Hyper in compliance with applicable law, regulatory obligations, contractual duties, and your own internal operating policies.",
    ],
  },
  {
    heading: "2. Acceptable Use and Prohibited Conduct",
    paragraphs: [
      "You may not use Nexio Hyper to commit fraud, conceal losses, falsify invoices, manipulate stock or billing records for unlawful purposes, or create misleading operational reports.",
      "You may not attempt unauthorized access to the product, related systems, other customer environments, approval workflows, or protected administrative functions. You may not bypass permissions, misuse role assignments, interfere with auditability, or tamper with activity histories, approvals, or stock movement records.",
      "You may not reverse engineer, copy, resell, repackage, sublicense, decompile, scrape at scale, disrupt, exploit, or otherwise misuse the software except where non-waivable law expressly permits a limited activity. Any illegal manipulation of stock, invoice, payment, approval, or user records is strictly prohibited and may result in immediate suspension and reporting where appropriate.",
    ],
  },
  {
    heading: "3. Data Privacy and Handling",
    paragraphs: [
      "Nexio Hyper may process operational and account information needed to provide the service, including user account identifiers, shop configuration data, inventory records, product and vendor records, billing and invoice metadata, approval activity, device identifiers, system logs, and other related business-use information submitted through the platform.",
      "You are responsible for ensuring that any customer, staff, supplier, business, or other personal or sensitive data you choose to store or process in Nexio Hyper is collected and used lawfully. You must apply appropriate access controls, internal policy restrictions, and operational safeguards for privacy-sensitive information.",
      "Where privacy, employment, consumer, tax, accounting, or other data-protection rules apply to your operations, you remain responsible for complying with those requirements and for configuring your internal use of Nexio Hyper accordingly.",
    ],
  },
  {
    heading: "4. Service Availability and Changes",
    paragraphs: [
      "Nexio Hyper is offered on a best-effort basis. Availability can be affected by maintenance, upgrades, third-party infrastructure, local network conditions, power failure, device issues, browser limitations, or events outside Nexio Hyper's reasonable control.",
      "Nexio Hyper may update, improve, restrict, suspend, or change features, workflows, interfaces, and operational limits where reasonably necessary for maintenance, security, legal compliance, or product evolution. The service does not guarantee uninterrupted availability or immunity from outage, sync delay, or device-specific behavior.",
    ],
  },
  {
    heading: "5. Intellectual Property and Product Rights",
    paragraphs: [
      "Nexio Hyper and its related software, product design, workflows, branding, visual assets, documentation, interface behavior, and associated intellectual property remain the property of Nexio Hyper and its licensors.",
      "Except for the limited right to use the service as authorized, no ownership rights are transferred to you. You may not copy, clone, republish, redistribute, commercially resell, white-label, or repackage Nexio Hyper or any substantial part of it without prior written permission.",
    ],
  },
  {
    heading: "6. Suspension, Restriction, and Enforcement",
    paragraphs: [
      "Nexio Hyper may suspend, restrict, investigate, or terminate access where there is suspected abuse, illegal activity, unauthorized access, policy violation, security risk, non-payment, or misuse of approval, billing, or stock controls.",
      "Nexio Hyper may preserve relevant logs and operational records reasonably necessary to investigate misuse, enforce these terms, protect the service, or comply with legal obligations.",
    ],
  },
  {
    heading: "7. Limitation of Responsibility",
    paragraphs: [
      "To the maximum extent permitted by applicable law, Nexio Hyper is not responsible for business interruption, lost profit, lost sales, lost data, stock discrepancies, or indirect or consequential losses arising from misuse of the product, credential compromise, incorrect data entry, network failure, device failure, or third-party service issues.",
      "You remain responsible for business decisions, staff permissions, operational controls, reconciliation practices, and legal compliance in your use of the platform.",
    ],
  },
  {
    heading: "8. Contact and Notices",
    paragraphs: [
      "Legal, privacy, and compliance contact details must be inserted before production release.",
      "Placeholder contact: legal@nexiohyper.example | privacy@nexiohyper.example | +00 0000 000 000",
    ],
  },
];

export function TermsPage() {
  return (
    <AuthShell
      variant="shop"
      badge="LEGAL NOTICE"
      title="Terms and Conditions"
      subcopy="Read the operating terms, privacy and data-handling expectations, acceptable use limits, and product rights governing Nexio Hyper."
      contentWidthClassName="max-w-[42rem]"
      footerLink={{ label: "Back to Login", to: "/login" }}
    >
      <div className="auth-legal-doc">
        <div className="auth-legal-doc__meta">
          <p className="auth-legal-doc__eyebrow">Combined Terms, Privacy, Acceptable Use, and IP Notice</p>
          <p className="auth-legal-doc__effective">Effective date: July 19, 2026</p>
        </div>

        <div className="rounded-2xl border border-cyan-300/15 bg-[#0b1117] px-4 py-3 text-sm leading-6 text-[#c6d3de]">
          This page is provided for informational and legal notice purposes only. No acceptance tracking or consent storage is performed on this screen in this release.
        </div>

        <Link to="/login" className="auth-terminal-link auth-legal-doc__backlink">
          Back to Login
        </Link>

        {SECTIONS.map((section) => (
          <section key={section.heading} className="auth-legal-doc__section">
            <h2>{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
      </div>
    </AuthShell>
  );
}
