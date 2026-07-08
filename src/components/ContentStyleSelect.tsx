import { I18nText } from "./I18nText";

type ContentStyleOption = {
  id: string;
  name: string;
  isDefault: boolean;
};

export function ContentStyleSelect({ styles, id }: { styles: ContentStyleOption[]; id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}><I18nText zh="生成风格" en="Content style" /></label>
      <select id={id} name="contentStyleId" defaultValue="">
        <option value="">使用默认风格 / Default style</option>
        {styles.map((style) => (
          <option key={style.id} value={style.id}>
            {style.name}{style.isDefault ? "（默认 / default）" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
