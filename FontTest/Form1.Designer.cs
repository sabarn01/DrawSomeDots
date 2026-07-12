namespace FontTest
{
    partial class Form1
    {
        /// <summary>
        /// Required designer variable.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        /// Clean up any resources being used.
        /// </summary>
        /// <param name="disposing">true if managed resources should be disposed; otherwise, false.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Windows Form Designer generated code

        /// <summary>
        /// Required method for Designer support - do not modify
        /// the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            this.pictureBox1 = new System.Windows.Forms.PictureBox();
            this.imgSize = new System.Windows.Forms.TextBox();
            this.fntsize = new System.Windows.Forms.TextBox();
            this.button1 = new System.Windows.Forms.Button();
            ((System.ComponentModel.ISupportInitialize)(this.pictureBox1)).BeginInit();
            this.SuspendLayout();
            // 
            // pictureBox1
            // 
            this.pictureBox1.Location = new System.Drawing.Point(2, 39);
            this.pictureBox1.Margin = new System.Windows.Forms.Padding(2, 2, 2, 2);
            this.pictureBox1.Name = "pictureBox1";
            this.pictureBox1.Size = new System.Drawing.Size(156, 117);
            this.pictureBox1.TabIndex = 0;
            this.pictureBox1.TabStop = false;
            // 
            // imgSize
            // 
            this.imgSize.Location = new System.Drawing.Point(5, 6);
            this.imgSize.Margin = new System.Windows.Forms.Padding(2, 2, 2, 2);
            this.imgSize.Name = "imgSize";
            this.imgSize.Size = new System.Drawing.Size(52, 20);
            this.imgSize.TabIndex = 1;
            // 
            // fntsize
            // 
            this.fntsize.Location = new System.Drawing.Point(74, 6);
            this.fntsize.Margin = new System.Windows.Forms.Padding(2, 2, 2, 2);
            this.fntsize.Name = "fntsize";
            this.fntsize.Size = new System.Drawing.Size(52, 20);
            this.fntsize.TabIndex = 2;
            this.fntsize.Text = "20";
            // 
            // button1
            // 
            this.button1.Location = new System.Drawing.Point(146, 8);
            this.button1.Margin = new System.Windows.Forms.Padding(2, 2, 2, 2);
            this.button1.Name = "button1";
            this.button1.Size = new System.Drawing.Size(53, 26);
            this.button1.TabIndex = 3;
            this.button1.Text = "button1";
            this.button1.UseVisualStyleBackColor = true;
            this.button1.Click += new System.EventHandler(this.button1_Click);
            // 
            // Form1
            // 
            this.AutoScaleDimensions = new System.Drawing.SizeF(6F, 13F);
            this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
            this.ClientSize = new System.Drawing.Size(785, 619);
            this.Controls.Add(this.button1);
            this.Controls.Add(this.fntsize);
            this.Controls.Add(this.imgSize);
            this.Controls.Add(this.pictureBox1);
            this.Margin = new System.Windows.Forms.Padding(2, 2, 2, 2);
            this.Name = "Form1";
            this.Text = "Form1";
            ((System.ComponentModel.ISupportInitialize)(this.pictureBox1)).EndInit();
            this.ResumeLayout(false);
            this.PerformLayout();

        }

        #endregion

        private System.Windows.Forms.PictureBox pictureBox1;
        private System.Windows.Forms.TextBox imgSize;
        private System.Windows.Forms.TextBox fntsize;
        private System.Windows.Forms.Button button1;
    }
}

