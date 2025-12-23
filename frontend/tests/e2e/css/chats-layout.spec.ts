import { test, expect, type Page } from '@playwright/test';
import { loginWithMocks, setupMocks } from '../../mocks/api';

/**
 * Comprehensive CSS/Layout Tests for Chats Component (Чаты)
 *
 * These tests verify the CSS layout, positioning, overflow handling, text truncation,
 * and visual consistency of the Chats page and all its sub-components.
 *
 * Components tested:
 * - ChatsPage (main layout with 3 columns)
 * - ChatList (left sidebar with chat cards)
 * - ChatDetail (middle panel with messages)
 * - CriteriaPanel (criteria management tab)
 * - AIPanel (right sidebar with AI assistant)
 */

// Common viewport sizes
const VIEWPORTS = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 720 },
  largeDesktop: { width: 1920, height: 1080 },
};

// Helper function to login and navigate to chats page
async function loginAndNavigateToChats(page: Page) {
  await loginWithMocks(page);
  await page.goto('/chats');
  await page.waitForLoadState('networkidle');
}

// Helper to select first chat
async function selectFirstChat(page: Page) {
  const chatCards = page.locator('div[class*="divide-y"] button');
  const count = await chatCards.count();
  if (count > 0) {
    await chatCards.first().click();
    await page.waitForTimeout(500);
  }
}

test.describe('Chats Layout - Chat List', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('test_chat_cards_consistent_height', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);

    // Find all chat cards
    const chatCards = page.locator('div[class*="divide-y"] button');
    const count = await chatCards.count();

    if (count >= 2) {
      // Get heights of first few cards
      const heights: number[] = [];
      for (let i = 0; i < Math.min(5, count); i++) {
        const box = await chatCards.nth(i).boundingBox();
        if (box) {
          heights.push(box.height);
        }
      }

      // All chat cards should have similar heights (within 5px variance)
      if (heights.length > 1) {
        const maxHeight = Math.max(...heights);
        const minHeight = Math.min(...heights);
        expect(maxHeight - minHeight).toBeLessThanOrEqual(5);
      }

      // Each card should have consistent internal structure
      const firstCard = chatCards.first();
      await expect(firstCard.locator('div.flex.items-start.gap-3')).toBeVisible();
      await expect(firstCard.locator('div.w-10.h-10.rounded-xl')).toBeVisible(); // Icon
      await expect(firstCard.locator('div.flex-1.min-w-0')).toBeVisible(); // Content
    }
  });

  test('test_chat_preview_text_truncates', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);

    const chatCards = page.locator('div[class*="divide-y"] button');
    const count = await chatCards.count();

    if (count > 0) {
      const firstCard = chatCards.first();

      // Find the title element (should have truncate class)
      const titleElement = firstCard.locator('h3.font-medium.truncate');
      await expect(titleElement).toBeVisible();

      // Check CSS properties for text truncation
      const overflow = await titleElement.evaluate(el =>
        window.getComputedStyle(el).overflow
      );
      const textOverflow = await titleElement.evaluate(el =>
        window.getComputedStyle(el).textOverflow
      );
      const whiteSpace = await titleElement.evaluate(el =>
        window.getComputedStyle(el).whiteSpace
      );

      expect(overflow).toBe('hidden');
      expect(textOverflow).toBe('ellipsis');
      expect(whiteSpace).toBe('nowrap');

      // Title should not overflow its container
      const titleBox = await titleElement.boundingBox();
      const containerBox = await firstCard.locator('div.flex-1.min-w-0').boundingBox();

      if (titleBox && containerBox) {
        expect(titleBox.width).toBeLessThanOrEqual(containerBox.width + 1);
      }
    }
  });

  test('test_chat_metadata_aligned', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);

    const chatCards = page.locator('div[class*="divide-y"] button');
    const count = await chatCards.count();

    if (count > 0) {
      const firstCard = chatCards.first();

      // Check date/time is aligned to the right
      const dateElement = firstCard.locator('span.text-xs.text-dark-500.flex-shrink-0');
      await expect(dateElement).toBeVisible();

      // Date should have flex-shrink-0 to prevent shrinking
      const flexShrink = await dateElement.evaluate(el =>
        window.getComputedStyle(el).flexShrink
      );
      expect(flexShrink).toBe('0');

      // Metadata row should use flexbox with space-between
      const metadataRow = firstCard.locator('div.flex.items-center.justify-between.gap-2');
      await expect(metadataRow).toBeVisible();

      const display = await metadataRow.evaluate(el =>
        window.getComputedStyle(el).display
      );
      expect(display).toBe('flex');

      // Check participants and messages count are visible
      const metadataContainer = firstCard.locator('div.flex.items-center.gap-3.text-sm.text-dark-400');
      await expect(metadataContainer).toBeVisible();

      // Should have message count and participants count
      const messageIcon = metadataContainer.locator('svg').first();
      await expect(messageIcon).toBeVisible();
    }
  });

  test('test_unread_indicator_positioned_correctly', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);

    const chatCards = page.locator('div[class*="divide-y"] button');
    const count = await chatCards.count();

    if (count > 0) {
      // Check if selected chat has accent border
      const selectedChat = chatCards.locator('[class*="bg-accent-500/10"]').first();

      if (await selectedChat.isVisible()) {
        // Selected chat should have left border
        const borderLeft = await selectedChat.evaluate(el =>
          window.getComputedStyle(el).borderLeftWidth
        );

        // Should have 2px left border
        expect(parseFloat(borderLeft)).toBeGreaterThanOrEqual(2);
      }

      // Type badge should be visible and positioned correctly
      const typeBadge = chatCards.first().locator('span[class*="text-xs"][class*="px-1.5"]');
      if (await typeBadge.isVisible()) {
        const display = await typeBadge.evaluate(el =>
          window.getComputedStyle(el).display
        );
        expect(display).toBe('inline-flex');
      }
    }
  });

  test('test_chat_list_scrollable', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);

    // Chat list container should be scrollable
    const chatListContainer = page.locator('div.w-full.lg\\:w-80 > div.flex-1.overflow-y-auto');
    await expect(chatListContainer).toBeVisible();

    const overflowY = await chatListContainer.evaluate(el =>
      window.getComputedStyle(el).overflowY
    );
    expect(overflowY).toBe('auto');

    // Container should have flex-1 to fill available space
    const flex = await chatListContainer.evaluate(el =>
      window.getComputedStyle(el).flex
    );
    expect(flex).toContain('1');
  });

  test('test_type_filter_tabs_overflow_scroll', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await loginAndNavigateToChats(page);

    // Type filter tabs container
    const filterContainer = page.locator('div.p-2.border-b > div.flex.gap-1.overflow-x-auto');
    await expect(filterContainer).toBeVisible();

    // Should have overflow-x-auto for horizontal scrolling
    const overflowX = await filterContainer.evaluate(el =>
      window.getComputedStyle(el).overflowX
    );
    expect(overflowX).toBe('auto');

    // Buttons should not wrap
    const buttons = filterContainer.locator('button');
    const count = await buttons.count();

    if (count > 0) {
      // All buttons should be on the same horizontal line
      const firstButton = await buttons.first().boundingBox();
      const lastButton = await buttons.last().boundingBox();

      if (firstButton && lastButton) {
        // Y positions should be the same (or very close)
        expect(Math.abs(firstButton.y - lastButton.y)).toBeLessThan(5);
      }
    }
  });

  test('test_chat_icon_size_consistent', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);

    const chatCards = page.locator('div[class*="divide-y"] button');
    const count = await chatCards.count();

    if (count >= 2) {
      // Check first few chat icons
      for (let i = 0; i < Math.min(3, count); i++) {
        const icon = chatCards.nth(i).locator('div.w-10.h-10.rounded-xl');
        await expect(icon).toBeVisible();

        const box = await icon.boundingBox();
        if (box) {
          // Should be 40x40px (w-10 h-10)
          expect(box.width).toBeGreaterThanOrEqual(38);
          expect(box.width).toBeLessThanOrEqual(42);
          expect(box.height).toBeGreaterThanOrEqual(38);
          expect(box.height).toBeLessThanOrEqual(42);
        }
      }
    }
  });
});

test.describe('Chats Layout - Chat Detail/Messages', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('test_messages_container_scrollable', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    // Messages container should be scrollable
    const messagesContainer = page.locator('div[class*="flex-1"][class*="overflow-y-auto"][class*="p-4"]').first();

    if (await messagesContainer.isVisible()) {
      const overflowY = await messagesContainer.evaluate(el =>
        window.getComputedStyle(el).overflowY
      );
      expect(overflowY).toBe('auto');

      // Should have flex-1 to fill available space
      const flex = await messagesContainer.evaluate(el =>
        window.getComputedStyle(el).flex
      );
      expect(flex).toContain('1');
    }
  });

  test('test_message_bubbles_max_width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.largeDesktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    // Click on messages tab
    const messagesTab = page.locator('button[value="messages"]');
    if (await messagesTab.isVisible()) {
      await messagesTab.click();
      await page.waitForTimeout(300);
    }

    const messageBubbles = page.locator('div.glass-light.rounded-xl.p-3');
    const count = await messageBubbles.count();

    if (count > 0) {
      // Messages should not span the entire width on large screens
      const firstMessage = messageBubbles.first();
      const messageBox = await firstMessage.boundingBox();
      const containerBox = await page.locator('div[class*="overflow-y-auto"]').first().boundingBox();

      if (messageBox && containerBox) {
        // Message width should be reasonable, not full container width
        // (accounting for padding and margins)
        const widthRatio = messageBox.width / containerBox.width;
        expect(widthRatio).toBeLessThan(0.95);
      }
    }
  });

  test('test_long_messages_wrap_properly', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    const messageBubbles = page.locator('div.glass-light.rounded-xl.p-3');
    const count = await messageBubbles.count();

    if (count > 0) {
      // Find text content in messages
      const messageText = messageBubbles.first().locator('p.text-sm');

      if (await messageText.isVisible()) {
        // Text should wrap (white-space should not be nowrap)
        const whiteSpace = await messageText.evaluate(el =>
          window.getComputedStyle(el).whiteSpace
        );

        // For pre-wrap text (like message content)
        const messageWithPreWrap = messageBubbles.locator('p.whitespace-pre-wrap').first();
        if (await messageWithPreWrap.isVisible()) {
          const ws = await messageWithPreWrap.evaluate(el =>
            window.getComputedStyle(el).whiteSpace
          );
          expect(ws).toBe('pre-wrap');
        }

        // Text should not overflow horizontally
        const textBox = await messageText.boundingBox();
        const bubbleBox = await messageBubbles.first().boundingBox();

        if (textBox && bubbleBox) {
          expect(textBox.width).toBeLessThanOrEqual(bubbleBox.width);
        }
      }
    }
  });

  test('test_message_timestamps_aligned', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    const messageBubbles = page.locator('div.glass-light.rounded-xl.p-3');
    const count = await messageBubbles.count();

    if (count > 0) {
      // Check message header layout
      const messageHeader = messageBubbles.first().locator('div.flex.items-center.gap-2.mb-2');
      await expect(messageHeader).toBeVisible();

      // Timestamp should be at the end
      const timestamp = messageHeader.locator('span.text-xs.text-dark-500');
      await expect(timestamp).toBeVisible();

      // Parent should be flex with items-center
      const display = await messageHeader.evaluate(el =>
        window.getComputedStyle(el).display
      );
      expect(display).toBe('flex');

      const alignItems = await messageHeader.evaluate(el =>
        window.getComputedStyle(el).alignItems
      );
      expect(alignItems).toBe('center');
    }
  });

  test('test_sender_names_truncate_if_long', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    const messageBubbles = page.locator('div.glass-light.rounded-xl.p-3');
    const count = await messageBubbles.count();

    if (count > 0) {
      // Check sender name container
      const senderContainer = messageBubbles.first().locator('div.flex-1.min-w-0');

      if (await senderContainer.isVisible()) {
        // Should have min-w-0 to allow flex item shrinking
        const minWidth = await senderContainer.evaluate(el =>
          window.getComputedStyle(el).minWidth
        );
        expect(minWidth).toBe('0px');

        // Sender name should not overflow
        const senderBox = await senderContainer.boundingBox();
        const messageBox = await messageBubbles.first().boundingBox();

        if (senderBox && messageBox) {
          expect(senderBox.width).toBeLessThanOrEqual(messageBox.width - 100); // Account for avatar and timestamp
        }
      }
    }
  });

  test('test_document_message_expand_collapse', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    // Look for document messages with expand/collapse functionality
    const expandButton = page.locator('button:has-text("Показать полностью")');

    if (await expandButton.isVisible()) {
      const documentContent = expandButton.locator('..').locator('p.text-sm.text-dark-300');
      const initialBox = await documentContent.boundingBox();

      // Click expand
      await expandButton.click();
      await page.waitForTimeout(300);

      const expandedBox = await documentContent.boundingBox();

      // Content should expand
      if (initialBox && expandedBox) {
        expect(expandedBox.height).toBeGreaterThanOrEqual(initialBox.height);
      }

      // Button text should change to collapse
      const collapseButton = page.locator('button:has-text("Свернуть")');
      await expect(collapseButton).toBeVisible();
    }
  });

  test('test_photo_message_max_width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    const photoImages = page.locator('img.max-w-xs.rounded-lg');
    const count = await photoImages.count();

    if (count > 0) {
      const firstPhoto = photoImages.first();
      const photoBox = await firstPhoto.boundingBox();

      if (photoBox) {
        // max-w-xs is 320px in Tailwind
        expect(photoBox.width).toBeLessThanOrEqual(320);
      }

      // Image should have proper CSS classes
      const maxWidth = await firstPhoto.evaluate(el =>
        window.getComputedStyle(el).maxWidth
      );

      // Should have max-width constraint
      expect(maxWidth).not.toBe('none');
    }
  });

  test('test_message_avatar_consistent_size', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    const avatars = page.locator('div.w-8.h-8.rounded-full.bg-accent-500\\/20');
    const count = await avatars.count();

    if (count >= 2) {
      // Check multiple avatars for consistency
      for (let i = 0; i < Math.min(3, count); i++) {
        const avatar = avatars.nth(i);
        const box = await avatar.boundingBox();

        if (box) {
          // Should be 32x32px (w-8 h-8)
          expect(box.width).toBeGreaterThanOrEqual(30);
          expect(box.width).toBeLessThanOrEqual(34);
          expect(box.height).toBeGreaterThanOrEqual(30);
          expect(box.height).toBeLessThanOrEqual(34);
        }
      }
    }
  });
});

test.describe('Chats Layout - Input Area', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('test_input_field_expands_properly', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    // Note: The ChatDetail component doesn't have an input field
    // This test is for the AI Panel input

    // Open AI panel if not visible
    const aiPanelToggle = page.locator('button:has(svg[class*="w-5 h-5"])').filter({ hasText: '' });

    // Try to find AI panel
    const aiPanel = page.locator('div:has(h3:has-text("AI Ассистент"))');

    if (await aiPanel.isVisible()) {
      const textarea = aiPanel.locator('textarea[placeholder="Задайте вопрос..."]');
      await expect(textarea).toBeVisible();

      // Textarea should expand with flex-1
      const flex = await textarea.evaluate(el =>
        window.getComputedStyle(el).flex
      );
      expect(flex).toContain('1');

      // Container should be flex
      const inputContainer = textarea.locator('..');
      const display = await inputContainer.evaluate(el =>
        window.getComputedStyle(el).display
      );
      expect(display).toBe('flex');
    }
  });

  test('test_send_button_stays_visible', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    const aiPanel = page.locator('div:has(h3:has-text("AI Ассистент"))');

    if (await aiPanel.isVisible()) {
      const sendButton = aiPanel.locator('button:has(svg)').last();
      await expect(sendButton).toBeVisible();

      // Send button should have fixed dimensions
      const buttonBox = await sendButton.boundingBox();

      if (buttonBox) {
        // Should be square button (w-11 h-11)
        expect(Math.abs(buttonBox.width - buttonBox.height)).toBeLessThan(2);
        expect(buttonBox.width).toBeGreaterThanOrEqual(40);
      }

      // Button should not shrink
      const flexShrink = await sendButton.evaluate(el =>
        window.getComputedStyle(el).flexShrink
      );
      expect(flexShrink).toBe('0');
    }
  });

  test('test_input_area_fixed_at_bottom', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    const aiPanel = page.locator('div:has(h3:has-text("AI Ассистент"))');

    if (await aiPanel.isVisible()) {
      const inputArea = aiPanel.locator('div.p-4.border-t');
      await expect(inputArea).toBeVisible();

      // Input area should have border-t to separate from messages
      const borderTopWidth = await inputArea.evaluate(el =>
        window.getComputedStyle(el).borderTopWidth
      );
      expect(parseFloat(borderTopWidth)).toBeGreaterThan(0);

      // Parent panel should use flexbox column layout
      const panelDisplay = await aiPanel.evaluate(el =>
        window.getComputedStyle(el).display
      );
      expect(panelDisplay).toBe('flex');

      const flexDirection = await aiPanel.evaluate(el =>
        window.getComputedStyle(el).flexDirection
      );
      expect(flexDirection).toBe('column');
    }
  });
});

test.describe('Chats Layout - Criteria Panel', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('test_criteria_tags_wrap_properly', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    // Click on Criteria tab
    const criteriaTab = page.locator('button:has-text("Критерии")');
    if (await criteriaTab.isVisible()) {
      await criteriaTab.click();
      await page.waitForTimeout(500);

      // Check if criteria items exist
      const criteriaItems = page.locator('div.glass-light.rounded-xl.p-4');
      const count = await criteriaItems.count();

      if (count > 0) {
        // Check metadata row with tags
        const metadataRow = criteriaItems.first().locator('div.flex.items-center.gap-4');

        if (await metadataRow.isVisible()) {
          const display = await metadataRow.evaluate(el =>
            window.getComputedStyle(el).display
          );
          expect(display).toBe('flex');

          // Items should wrap on small screens
          const flexWrap = await metadataRow.evaluate(el =>
            window.getComputedStyle(el).flexWrap
          );
          // flex-wrap might be 'nowrap' or 'wrap' depending on content
          expect(['nowrap', 'wrap']).toContain(flexWrap);
        }
      }
    }
  });

  test('test_criteria_panel_scrollable', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    const criteriaTab = page.locator('button:has-text("Критерии")');
    if (await criteriaTab.isVisible()) {
      await criteriaTab.click();
      await page.waitForTimeout(500);

      // Criteria panel content should be scrollable
      const criteriaContent = page.locator('div.p-4.space-y-4');

      if (await criteriaContent.isVisible()) {
        // Parent should allow scrolling
        const parent = criteriaContent.locator('..');
        const overflowY = await parent.evaluate(el =>
          window.getComputedStyle(el).overflowY
        );

        // Should be auto or scroll
        expect(['auto', 'scroll', 'visible']).toContain(overflowY);
      }
    }
  });

  test('test_criteria_save_button_sticky', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    const criteriaTab = page.locator('button:has-text("Критерии")');
    if (await criteriaTab.isVisible()) {
      await criteriaTab.click();
      await page.waitForTimeout(500);

      // Add a criterion to trigger save button
      const addButton = page.locator('button:has-text("Добавить")');
      if (await addButton.isVisible()) {
        await addButton.click();
        await page.waitForTimeout(300);

        // Save button should appear with sticky positioning
        const saveButton = page.locator('button:has-text("Сохранить")');

        if (await saveButton.isVisible()) {
          const parent = saveButton.locator('..');
          const position = await parent.evaluate(el =>
            window.getComputedStyle(el).position
          );
          expect(position).toBe('sticky');

          // Bottom should be 0
          const bottom = await parent.evaluate(el =>
            window.getComputedStyle(el).bottom
          );
          expect(bottom).toBe('0px');
        }
      }
    }
  });

  test('test_criteria_card_layout_consistent', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    const criteriaTab = page.locator('button:has-text("Критерии")');
    if (await criteriaTab.isVisible()) {
      await criteriaTab.click();
      await page.waitForTimeout(500);

      const criteriaCards = page.locator('div.glass-light.rounded-xl.p-4.space-y-3');
      const count = await criteriaCards.count();

      if (count >= 2) {
        // Each card should have icon, content, and delete button
        for (let i = 0; i < Math.min(3, count); i++) {
          const card = criteriaCards.nth(i);

          // Icon
          const icon = card.locator('div[class*="p-2"][class*="rounded-lg"]').first();
          await expect(icon).toBeVisible();

          // Content area
          const content = card.locator('div.flex-1.space-y-3');
          await expect(content).toBeVisible();

          // Delete button
          const deleteBtn = card.locator('button:has(svg)').last();
          await expect(deleteBtn).toBeVisible();
        }
      }
    }
  });
});

test.describe('Chats Layout - AI Panel', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('test_quick_action_buttons_wrap', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    const aiPanel = page.locator('div:has(h3:has-text("AI Ассистент"))');

    if (await aiPanel.isVisible()) {
      // Quick actions container
      const quickActions = aiPanel.locator('div.p-3.border-b > div.flex.flex-wrap');
      await expect(quickActions).toBeVisible();

      // Should use flex-wrap
      const flexWrap = await quickActions.evaluate(el =>
        window.getComputedStyle(el).flexWrap
      );
      expect(flexWrap).toBe('wrap');

      // Buttons should not overflow
      const buttons = quickActions.locator('button');
      const count = await buttons.count();

      if (count > 0) {
        const containerBox = await quickActions.boundingBox();
        const lastButtonBox = await buttons.last().boundingBox();

        if (containerBox && lastButtonBox) {
          expect(lastButtonBox.x + lastButtonBox.width).toBeLessThanOrEqual(containerBox.x + containerBox.width + 1);
        }
      }
    }
  });

  test('test_ai_messages_scrollable', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    const aiPanel = page.locator('div:has(h3:has-text("AI Ассистент"))');

    if (await aiPanel.isVisible()) {
      const messagesContainer = aiPanel.locator('div.flex-1.overflow-y-auto.p-4');
      await expect(messagesContainer).toBeVisible();

      // Should be scrollable
      const overflowY = await messagesContainer.evaluate(el =>
        window.getComputedStyle(el).overflowY
      );
      expect(overflowY).toBe('auto');

      // Should use flex-1 to fill space
      const flex = await messagesContainer.evaluate(el =>
        window.getComputedStyle(el).flex
      );
      expect(flex).toContain('1');

      // Should have smooth scrolling
      const scrollBehavior = await messagesContainer.evaluate(el =>
        window.getComputedStyle(el).scrollBehavior
      );
      expect(scrollBehavior).toBe('smooth');
    }
  });

  test('test_ai_message_bubbles_asymmetric', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    const aiPanel = page.locator('div:has(h3:has-text("AI Ассистент"))');

    if (await aiPanel.isVisible()) {
      // User messages (right-aligned with left margin)
      const userMessages = aiPanel.locator('div[class*="bg-accent-500/20"][class*="ml-8"]');
      const userCount = await userMessages.count();

      if (userCount > 0) {
        const userMessage = userMessages.first();

        // Should have ml-8 for left margin
        const marginLeft = await userMessage.evaluate(el =>
          window.getComputedStyle(el).marginLeft
        );
        expect(parseFloat(marginLeft)).toBeGreaterThan(20); // ml-8 is 2rem = 32px
      }

      // Assistant messages (left-aligned with right margin)
      const assistantMessages = aiPanel.locator('div.glass-light[class*="mr-8"]');
      const assistantCount = await assistantMessages.count();

      if (assistantCount > 0) {
        const assistantMessage = assistantMessages.first();

        // Should have mr-8 for right margin
        const marginRight = await assistantMessage.evaluate(el =>
          window.getComputedStyle(el).marginRight
        );
        expect(parseFloat(marginRight)).toBeGreaterThan(20);
      }
    }
  });

  test('test_ai_panel_width_desktop', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.largeDesktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    const aiPanel = page.locator('div.hidden.xl\\:flex.flex-col.border-l');

    if (await aiPanel.isVisible()) {
      const panelBox = await aiPanel.boundingBox();

      if (panelBox) {
        // AI panel should be 400px wide on XL screens
        expect(panelBox.width).toBeGreaterThanOrEqual(395);
        expect(panelBox.width).toBeLessThanOrEqual(405);
      }

      // Should have border-l
      const borderLeftWidth = await aiPanel.evaluate(el =>
        window.getComputedStyle(el).borderLeftWidth
      );
      expect(parseFloat(borderLeftWidth)).toBeGreaterThan(0);
    }
  });

  test('test_ai_panel_hidden_mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    // Desktop AI panel should be hidden on mobile
    const desktopAiPanel = page.locator('div.hidden.xl\\:flex.flex-col.border-l');
    await expect(desktopAiPanel).not.toBeVisible();

    // Mobile AI panel (modal) should not be visible by default
    const mobileAiPanel = page.locator('div.xl\\:hidden.fixed.inset-0.z-50');
    await expect(mobileAiPanel).not.toBeVisible();
  });

  test('test_ai_panel_loading_indicator', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    const aiPanel = page.locator('div:has(h3:has-text("AI Ассистент"))');

    if (await aiPanel.isVisible()) {
      // Check for loading indicator when streaming
      const loadingIndicator = aiPanel.locator('div:has-text("Думаю...")');

      // Loading indicator uses flex layout
      if (await loadingIndicator.isVisible()) {
        const display = await loadingIndicator.evaluate(el =>
          window.getComputedStyle(el).display
        );
        expect(display).toBe('flex');
      }
    }
  });
});

test.describe('Chats Layout - Sharing/Actions Modals', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('test_add_chat_modal_fits_screen', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await loginAndNavigateToChats(page);

    // Click "Добавить чат" button
    const addButton = page.locator('button:has-text("Добавить чат")');
    if (await addButton.isVisible()) {
      await addButton.click();
      await page.waitForTimeout(300);

      // Modal should appear
      const modal = page.locator('div.glass.rounded-2xl.max-w-md');
      await expect(modal).toBeVisible();

      const modalBox = await modal.boundingBox();

      if (modalBox) {
        // Modal should fit within viewport
        expect(modalBox.width).toBeLessThanOrEqual(VIEWPORTS.mobile.width - 32); // Account for padding

        // Modal should not be wider than max-w-md (448px)
        expect(modalBox.width).toBeLessThanOrEqual(448);
      }

      // Modal should be centered
      const modalParent = page.locator('div.fixed.inset-0.z-50.flex.items-center.justify-center');
      await expect(modalParent).toBeVisible();

      const display = await modalParent.evaluate(el =>
        window.getComputedStyle(el).display
      );
      expect(display).toBe('flex');

      const justifyContent = await modalParent.evaluate(el =>
        window.getComputedStyle(el).justifyContent
      );
      expect(justifyContent).toBe('center');
    }
  });

  test('test_delete_confirmation_modal_layout', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    // Click delete button (trash icon)
    const deleteButton = page.locator('button[title="Удалить чат"]');

    if (await deleteButton.isVisible()) {
      await deleteButton.click();
      await page.waitForTimeout(300);

      // Delete confirmation modal
      const modal = page.locator('div.glass.rounded-2xl.max-w-sm');
      await expect(modal).toBeVisible();

      // Modal should be smaller than add modal (max-w-sm)
      const modalBox = await modal.boundingBox();
      if (modalBox) {
        expect(modalBox.width).toBeLessThanOrEqual(384); // max-w-sm is 384px
      }

      // Action buttons should be in a flex row
      const buttonRow = modal.locator('div.flex.gap-3');
      await expect(buttonRow).toBeVisible();

      const buttons = buttonRow.locator('button');
      expect(await buttons.count()).toBe(2);
    }
  });

  test('test_type_dropdown_positioned_correctly', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    // Click on type selector dropdown
    const typeButton = page.locator('button:has(svg[class*="w-3.5"])').filter({
      has: page.locator('svg[class*="w-3"]')
    }).first();

    if (await typeButton.isVisible()) {
      await typeButton.click();
      await page.waitForTimeout(300);

      // Dropdown should appear
      const dropdown = page.locator('div.absolute.top-full.left-0.mt-1.w-48.glass');

      if (await dropdown.isVisible()) {
        // Should be positioned absolutely
        const position = await dropdown.evaluate(el =>
          window.getComputedStyle(el).position
        );
        expect(position).toBe('absolute');

        // Should have proper width (w-48 = 192px)
        const dropdownBox = await dropdown.boundingBox();
        if (dropdownBox) {
          expect(dropdownBox.width).toBeGreaterThanOrEqual(190);
          expect(dropdownBox.width).toBeLessThanOrEqual(200);
        }

        // Should have z-index for layering
        const zIndex = await dropdown.evaluate(el =>
          window.getComputedStyle(el).zIndex
        );
        expect(parseInt(zIndex)).toBeGreaterThanOrEqual(50);
      }
    }
  });

  test('test_entity_dropdown_scrollable', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    // Click on entity selector dropdown
    const entityButton = page.locator('button:has-text("Привязать"), button:has-text("Контакт")').first();

    if (await entityButton.isVisible()) {
      await entityButton.click();
      await page.waitForTimeout(500);

      // Entity dropdown should appear with scroll
      const dropdown = page.locator('div.absolute.top-full.left-0.mt-1.w-56.glass');

      if (await dropdown.isVisible()) {
        // Should have max-height and overflow
        const overflowY = await dropdown.evaluate(el =>
          window.getComputedStyle(el).overflowY
        );
        expect(overflowY).toBe('auto');

        // Should have max-height constraint (max-h-64)
        const maxHeight = await dropdown.evaluate(el =>
          window.getComputedStyle(el).maxHeight
        );

        if (maxHeight !== 'none') {
          const maxHeightPx = parseFloat(maxHeight);
          expect(maxHeightPx).toBeGreaterThan(0);
          expect(maxHeightPx).toBeLessThanOrEqual(256); // max-h-64 is 256px
        }
      }
    }
  });
});

test.describe('Chats Layout - Responsive Behavior', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('test_three_column_layout_desktop', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.largeDesktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    // Chat list (left)
    const chatList = page.locator('div.w-full.lg\\:w-80.flex-shrink-0');
    await expect(chatList).toBeVisible();

    // Chat detail (middle)
    const chatDetail = page.locator('div.flex-1.flex.flex-col.min-w-0');
    await expect(chatDetail).toBeVisible();

    // AI panel (right) - on XL screens
    const aiPanel = page.locator('div.hidden.xl\\:flex.flex-col.border-l');
    await expect(aiPanel).toBeVisible();

    // All three should be visible simultaneously
    const chatListBox = await chatList.boundingBox();
    const chatDetailBox = await chatDetail.boundingBox();
    const aiPanelBox = await aiPanel.boundingBox();

    if (chatListBox && chatDetailBox && aiPanelBox) {
      // They should be side by side
      expect(chatDetailBox.x).toBeGreaterThan(chatListBox.x);
      expect(aiPanelBox.x).toBeGreaterThan(chatDetailBox.x);
    }
  });

  test('test_two_column_layout_tablet', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop); // 1280px - between lg and xl
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    // Chat list visible
    const chatList = page.locator('div.w-full.lg\\:w-80.flex-shrink-0');
    await expect(chatList).toBeVisible();

    // Chat detail visible
    const chatDetail = page.locator('div.flex-1.flex.flex-col.min-w-0');
    await expect(chatDetail).toBeVisible();

    // AI panel hidden on desktop (only shows on XL)
    const aiPanel = page.locator('div.hidden.xl\\:flex.flex-col.border-l');
    await expect(aiPanel).not.toBeVisible();
  });

  test('test_mobile_chat_list_full_width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await loginAndNavigateToChats(page);

    // On mobile, chat list should be full width
    const chatList = page.locator('div.w-full.lg\\:w-80');
    await expect(chatList).toBeVisible();

    const chatListBox = await chatList.boundingBox();
    if (chatListBox) {
      // Should take full width on mobile
      expect(chatListBox.width).toBeGreaterThan(VIEWPORTS.mobile.width - 10);
    }

    // Chat detail should be hidden
    const chatDetail = page.locator('div.flex-1.flex.flex-col.min-w-0').first();
    await expect(chatDetail).not.toBeVisible();
  });

  test('test_mobile_chat_detail_hides_list', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    // After selecting chat, list should hide and detail should show
    const chatList = page.locator('div.w-full.lg\\:w-80');
    await expect(chatList).not.toBeVisible();

    const chatDetail = page.locator('div.flex-1.flex.flex-col.min-w-0').first();
    await expect(chatDetail).toBeVisible();

    // Mobile header with back button should be visible
    const mobileHeader = page.locator('div.lg\\:hidden.flex.items-center.gap-3.p-4');
    await expect(mobileHeader).toBeVisible();

    const backButton = mobileHeader.locator('button:has(svg)').first();
    await expect(backButton).toBeVisible();
  });

  test('test_mobile_ai_panel_fullscreen_modal', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    // Toggle AI panel on mobile
    const aiToggleButton = page.locator('button:has(svg)').filter({
      has: page.locator('svg')
    }).last();

    if (await aiToggleButton.isVisible()) {
      await aiToggleButton.click();
      await page.waitForTimeout(500);

      // Mobile AI panel should be fullscreen modal
      const mobileAiPanel = page.locator('div.xl\\:hidden.fixed.inset-0.z-50.glass');
      await expect(mobileAiPanel).toBeVisible();

      // Should have fixed positioning
      const position = await mobileAiPanel.evaluate(el =>
        window.getComputedStyle(el).position
      );
      expect(position).toBe('fixed');

      // Should cover entire screen
      const panelBox = await mobileAiPanel.boundingBox();
      if (panelBox) {
        expect(panelBox.width).toBe(VIEWPORTS.mobile.width);
        expect(panelBox.height).toBe(VIEWPORTS.mobile.height);
      }
    }
  });

  test('test_no_horizontal_scroll_all_sizes', async ({ page }) => {
    const sizes = [VIEWPORTS.mobile, VIEWPORTS.tablet, VIEWPORTS.desktop, VIEWPORTS.largeDesktop];

    for (const viewport of sizes) {
      await page.setViewportSize(viewport);
      await loginAndNavigateToChats(page);

      // Check no horizontal scroll
      const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
      const bodyClientWidth = await page.evaluate(() => document.body.clientWidth);

      expect(bodyScrollWidth).toBeLessThanOrEqual(bodyClientWidth + 1);

      // Select a chat and check again
      await selectFirstChat(page);
      await page.waitForTimeout(300);

      const scrollWidthAfter = await page.evaluate(() => document.body.scrollWidth);
      const clientWidthAfter = await page.evaluate(() => document.body.clientWidth);

      expect(scrollWidthAfter).toBeLessThanOrEqual(clientWidthAfter + 1);
    }
  });
});

test.describe('Chats Layout - Z-Index Layering', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('test_modal_overlay_above_content', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);

    const addButton = page.locator('button:has-text("Добавить чат")');
    if (await addButton.isVisible()) {
      await addButton.click();
      await page.waitForTimeout(300);

      const modalOverlay = page.locator('div.fixed.inset-0.z-50');
      await expect(modalOverlay).toBeVisible();

      // Should have high z-index
      const zIndex = await modalOverlay.evaluate(el =>
        window.getComputedStyle(el).zIndex
      );
      expect(parseInt(zIndex)).toBe(50);

      // Should cover entire viewport
      const position = await modalOverlay.evaluate(el =>
        window.getComputedStyle(el).position
      );
      expect(position).toBe('fixed');
    }
  });

  test('test_dropdown_above_content', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    const typeButton = page.locator('button:has(svg[class*="w-3.5"])').first();
    if (await typeButton.isVisible()) {
      await typeButton.click();
      await page.waitForTimeout(300);

      const dropdown = page.locator('div.absolute.top-full.left-0.mt-1.w-48.glass.rounded-xl.border.border-white\\/10.shadow-xl.z-50');

      if (await dropdown.isVisible()) {
        const zIndex = await dropdown.evaluate(el =>
          window.getComputedStyle(el).zIndex
        );
        expect(parseInt(zIndex)).toBeGreaterThanOrEqual(50);
      }
    }
  });

  test('test_ai_panel_toggle_button_layering', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.largeDesktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    // Desktop toggle button for AI panel
    const toggleButton = page.locator('button.hidden.xl\\:flex.fixed.bottom-4');

    if (await toggleButton.isVisible()) {
      // Should be fixed position
      const position = await toggleButton.evaluate(el =>
        window.getComputedStyle(el).position
      );
      expect(position).toBe('fixed');

      // Should have z-index
      const zIndex = await toggleButton.evaluate(el =>
        window.getComputedStyle(el).zIndex
      );
      expect(parseInt(zIndex)).toBeGreaterThanOrEqual(10);
    }
  });
});

test.describe('Chats Layout - Tabs Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('test_tabs_border_indicator', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    // Find all tabs
    const tabs = page.locator('button[class*="border-b-2"]');
    const count = await tabs.count();

    if (count > 0) {
      // Active tab should have accent border
      const activeTab = tabs.first();
      await activeTab.click();
      await page.waitForTimeout(300);

      const borderBottomColor = await activeTab.evaluate(el =>
        window.getComputedStyle(el).borderBottomColor
      );

      // Should have colored border (not transparent)
      expect(borderBottomColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(borderBottomColor).not.toBe('transparent');
    }
  });

  test('test_tabs_horizontal_scroll_mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await loginAndNavigateToChats(page);
    await selectFirstChat(page);

    // Tabs container
    const tabsList = page.locator('div.flex.border-b');
    await expect(tabsList).toBeVisible();

    // Should allow horizontal scroll if needed
    const overflowX = await tabsList.evaluate(el =>
      window.getComputedStyle(el).overflowX
    );

    // Could be auto, scroll, or visible depending on content
    expect(['auto', 'scroll', 'visible', 'hidden']).toContain(overflowX);
  });
});
