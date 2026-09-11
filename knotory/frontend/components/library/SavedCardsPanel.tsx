"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchSavedFlashcards, type SavedFlashcard } from "@/lib/api";

export default function SavedCardsPanel() {
  const [items, setItems] = useState<SavedFlashcard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchSavedFlashcards(20)
      .then((data) => {
        if (!cancelled) setItems(data.items);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || items.length === 0) return null;

  return (
    <section className="card card--desk library-saved" id="library-saved">
      <div className="card__head card__head--compact">
        <div>
          <p className="card__kicker">搞懂清单</p>
          <h2 className="card__title">你保存过的闪卡</h2>
          <p className="card__sub">相关内容再来时，会优先弹出这些卡</p>
        </div>
        <Link href="/" className="btn btn-ghost btn-sm">
          继续刷读
        </Link>
      </div>
      <ul className="library-saved__list">
        {items.map((item) => (
          <li key={item.id} className="library-saved__item">
            <p className="library-saved__q">{item.front_text}</p>
            <p className="library-saved__meta">
              {item.topic}
              {item.wiki_file_name ? (
                <>
                  {" · "}
                  <Link href={`/library?wiki=${encodeURIComponent(item.wiki_file_name)}`}>
                    查看出处
                  </Link>
                </>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
