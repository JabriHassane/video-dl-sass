import { useState } from 'react';
import { useSiteContent } from '../SiteContentContext.jsx';

const DEFAULTS = {
  eyebrow: 'FAQ',
  title: 'Questions fréquentes',
  items: [],
};

function FaqItem({ item, isOpen, onToggle }) {
  return (
    <div className={`faq-item ${isOpen ? 'open' : ''}`}>
      <button className="faq-question" onClick={onToggle}>
        <span>{item.q}</span>
        <span className="faq-icon">{isOpen ? '−' : '+'}</span>
      </button>
      {isOpen && <div className="faq-answer">{item.a}</div>}
    </div>
  );
}

export default function Faq() {
  const { data } = useSiteContent('faq', DEFAULTS);
  const [openIndex, setOpenIndex] = useState(0);
  const items = data.items ?? [];

  return (
    <div className="content-page">
      <section className="pricing-hero">
        <span className="eyebrow">{data.eyebrow}</span>
        <h1>{data.title}</h1>
      </section>

      <section className="section faq-list">
        {items.map((item, i) => (
          <FaqItem
            key={item.q}
            item={item}
            isOpen={openIndex === i}
            onToggle={() => setOpenIndex(openIndex === i ? -1 : i)}
          />
        ))}
      </section>
    </div>
  );
}
