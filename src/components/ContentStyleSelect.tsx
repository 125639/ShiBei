type ContentStyleOption = {
  id: string;
  name: string;
  isDefault: boolean;
};

export function ContentStyleSelect({ styles, id }: { styles: ContentStyleOption[]; id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>生成风格</label>
      <select id={id} name="contentStyleId" defaultValue="">
        <option value="">使用默认风格</option>
        {styles.map((style) => (
          <option key={style.id} value={style.id}>
            {style.name}{style.isDefault ? "（默认）" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
