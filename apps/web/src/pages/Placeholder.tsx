export function Placeholder({ title, stage }: { title: string; stage: number }) {
  return (
    <>
      <h2>{title}</h2>
      <div className="card placeholder">
        <p>המסך ייבנה בשלב {stage} של הפרויקט.</p>
        <p className="mu">התפריט וההרשאות כבר פעילים, כך שאפשר לבדוק מי רואה את המסך.</p>
      </div>
    </>
  );
}
