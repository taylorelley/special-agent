package ai.specialagent.android.ui

import androidx.compose.runtime.Composable
import ai.specialagent.android.MainViewModel
import ai.specialagent.android.ui.chat.ChatSheetContent

@Composable
fun ChatSheet(viewModel: MainViewModel) {
  ChatSheetContent(viewModel = viewModel)
}
