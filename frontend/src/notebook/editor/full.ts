// Registra os blocos do editor completo do Caderno. Importar este módulo
// (efeito colateral) antes de montar um editor com `variant: "full"`.
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import { FileDrop, registerFullExtensions } from "./extensions";
import { Attachment, Callout, CodeBlock, NoteImage } from "./nodes/Blocks";
import { CourseRef } from "./nodes/CourseRef";
import { MathBlock, MathInline } from "./nodes/Math";
import { CourseMentions } from "./suggestions";

registerFullExtensions((onFiles) => [
  Subscript,
  Superscript,
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: true, cellMinWidth: 60 } }),
  CodeBlock,
  MathInline,
  MathBlock,
  NoteImage,
  Attachment,
  Callout,
  CourseRef,
  CourseMentions,
  ...(onFiles ? [FileDrop(onFiles)] : []),
]);
