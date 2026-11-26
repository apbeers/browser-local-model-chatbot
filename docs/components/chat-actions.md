# js/ui/chat/chat-actions.js — chat and project menus
- `chatMenu(chatEntry)`: Rename, Move to project, Export (Markdown/JSON), Delete.
- `projectMenu(project)`: Edit, New chat in project, Export, Delete (keep or delete chats).
- `editProject(project | null)`: dialog with name, instructions, default model, auto-delete. Resolves to the saved project.
Menus are dialogs built by `actionSheet(title, [[label, fn, isDanger], ...])`.
