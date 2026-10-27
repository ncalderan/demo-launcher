import type { TalkTrack } from '../domain/types';

/** "What to say" panel: the field-ready story beats for the SE. */
export function TalkTrackPanel({ talkTrack }: { talkTrack: TalkTrack }) {
  return (
    <section className="panel talk-track">
      <h2>What to say</h2>
      <div className="tt-row">
        <span className="tt-label">Customer problem</span>
        <p>{talkTrack.customerProblem}</p>
      </div>
      <div className="tt-row">
        <span className="tt-label">What Cribl does</span>
        <p>{talkTrack.criblAction}</p>
      </div>
      <div className="tt-row">
        <span className="tt-label">Proof point</span>
        <p>{talkTrack.proofPoint}</p>
      </div>
      {talkTrack.bullets && talkTrack.bullets.length > 0 && (
        <ul className="tt-bullets">
          {talkTrack.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
