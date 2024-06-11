using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Windows.Documents;
using System.Windows;
using System.Windows.Shapes;
using System.Windows.Media;

namespace DrawSomeDots
{
    class AdornWithDots : Adorner 
    {

        public AdornWithDots(int Number,UIElement adornedElement)
            : base(adornedElement)
        {

        }
        int Number = 1000;
        int Loop = 0;
        protected override void OnRender(System.Windows.Media.DrawingContext drawingContext)
        {
            Random r = new Random();
            Rect adornedElementRect = new Rect(this.AdornedElement.DesiredSize);
            Point stPt = new Point(adornedElementRect.X, adornedElementRect.Y);
            for (int x = 0; x < Number; x++)
            {

                Ellipse e = new Ellipse();
                e.Width = 4;
                 
                Brush b = new SolidColorBrush(new Color() { R =(byte) r.Next(0,255), G =(byte) r.Next(0,255),B =(byte) r.Next(0,255) });
                
                Pen p = new Pen(Brushes.Black,1);
                int Rad = 3 ;
                drawingContext.DrawEllipse(b, p, stPt, Rad, Rad);
                stPt.X += (Rad * 2) + 1;
                if (stPt.X > adornedElementRect.Width)
                {
                    stPt.X = 3;
                    stPt.Y += 3;
                }

                
            }

            // Some arbitrary drawing implements.
          
        }

    }
}
